import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { Frame, LogEntry, WorkflowStep } from './types.js';
import { describeMeasurement, measurePath, type Measurement, type RulerPoint } from './ruler.js';
import { parseMeasureQuery, resolvePath, type MappedElement } from './element-map.js';
import { makeBaseline, recalibrate, remapPoint, type Baseline, type Calibration } from './calibration.js';

/** Consecutive failed groundings that trigger one automatic recalibration. */
export const AUTO_RECALIBRATE_AFTER = 2;

/** A finished measurement kept in the Ruler panel (and logged for the model). */
export interface SavedMeasurement {
  id: string;
  by: string;
  labels: string[];
  measurement: Measurement;
  line: string;
}

/** A measurement query resolved against the element map on one frame. */
export function runMeasureQuery(text: string, map: MappedElement[], frame: Frame): { measurement: Measurement; labels: string[]; line: string } {
  const { points, labels } = resolvePath(parseMeasureQuery(text), map, frame.srcW, frame.srcH);
  const measurement = measurePath(points, frame.srcW, frame.srcH);
  return { measurement, labels, line: describeMeasurement(measurement, labels) };
}

/** A stored step in the recalibrated layout: its target and drift-corrected target remapped. */
export function remapStep(cal: Calibration, s: WorkflowStep): WorkflowStep {
  const p = remapPoint(cal, { x: s.x, y: s.y });
  const fixed = s.correctedX !== undefined && s.correctedY !== undefined ? remapPoint(cal, { x: s.correctedX, y: s.correctedY }) : null;
  return { ...s, x: p.x, y: p.y, ...(fixed ? { correctedX: fixed.x, correctedY: fixed.y } : {}) };
}

/** A saved measurement re-measured in the recalibrated layout on the live screen size. */
export function remapMeasurement(cal: Calibration, saved: SavedMeasurement, live: Frame): SavedMeasurement {
  const measurement = measurePath(saved.measurement.points.map((p) => remapPoint(cal, p)), live.srcW, live.srcH);
  return { ...saved, measurement, line: describeMeasurement(measurement, saved.labels) };
}

/**
 * Tally of consecutive grounding failures. A halted step (abort, disarm, budget) does not
 * count; a success resets; reaching the threshold triggers once and resets.
 */
export function tallyGrounding(count: number, out: { ok: boolean; halt?: boolean }): { count: number; trigger: boolean } {
  if (out.halt) return { count, trigger: false };
  if (out.ok) return { count: 0, trigger: false };
  return count + 1 >= AUTO_RECALIBRATE_AFTER ? { count: 0, trigger: true } : { count: count + 1, trigger: false };
}

/** What the ruler needs from the engine. */
export interface MeasureDeps {
  /** Recent frames, newest first (state: re-renders keep the live measurement current). */
  frames: Frame[];
  framesRef: MutableRefObject<Frame[]>;
  /** The current element map (annotations, plan steps, saved flows). */
  elementMap: () => MappedElement[];
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  /** Rescales the engine's stored coordinates (workflow steps, saved flows). */
  rescale: (cal: Calibration) => void;
}

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The screen ruler: click points on the live frame (re-measured as frames refresh) or on a
 * picked gallery frame, AI/command measurements between named elements, a recalibration
 * baseline, and automatic recalibration after repeated grounding failures.
 */
export function useMeasure({ frames, framesRef, elementMap, addLog, rescale }: MeasureDeps) {
  const [on, setOn] = useState(false);
  const [points, setPoints] = useState<RulerPoint[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  /** The gallery frame being measured; null measures the live frame. */
  const [frameId, setFrameId] = useState<number | null>(null);
  const [measurements, setMeasurements] = useState<SavedMeasurement[]>([]);
  const [baseline, setBaselineState] = useState<Baseline | null>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const baselineRef = useRef<Baseline | null>(null);
  const pointsRef = useRef<RulerPoint[]>([]);
  const failuresRef = useRef(0);

  const frame = (frameId === null ? frames[0] : frames.find((f) => f.id === frameId)) ?? null;
  const measurement = frame ? measurePath(points, frame.srcW, frame.srcH) : null;

  const showPoints = (next: RulerPoint[], nextLabels: string[] = []) => {
    pointsRef.current = next;
    setPoints(next);
    setLabels(nextLabels);
  };

  const keep = useCallback((by: string, measured: Measurement, names: string[], line: string) => {
    setMeasurements((list) => [{ id: nextId(), by, labels: names, measurement: measured, line }, ...list].slice(0, 20));
  }, []);

  const toggle = () => {
    setOn((v) => !v);
    setFrameId(null);
  };

  const addPoint = (p: RulerPoint) => showPoints([...pointsRef.current, p]);
  const undo = () => showPoints(pointsRef.current.slice(0, -1));
  const clear = () => showPoints([]);

  /** Measures a gallery frame (custom measurement), or the live frame again with null. */
  const measureFrame = (id: number | null) => {
    setOn(true);
    setFrameId(id);
    showPoints([]);
  };

  /** Keeps the clicked polyline as a measurement and logs it. */
  const saveRuler = () => {
    if (!measurement?.segments.length) {
      addLog('Ruler', 'Click at least two points on the screen to measure', 'warn');
      return;
    }
    const line = describeMeasurement(measurement, labels);
    keep('You', measurement, labels, line);
    addLog('Ruler', `Measured${frameId === null ? '' : ` on frame #${frameId}`}: ${line}`, 'ok');
  };

  /**
   * Measures "A to B [to C…]" between mapped elements, coordinates or edges on the live frame.
   * The result is drawn, kept and logged (the log is the model's context). Throws loudly.
   */
  const measureQuery = useCallback((text: string, by: string): string => {
    const live = framesRef.current[0];
    if (!live) throw new Error('No captured frame yet — share the screen or connect the bridge before measuring');
    const r = runMeasureQuery(text, elementMap(), live);
    pointsRef.current = r.measurement.points;
    setPoints(r.measurement.points);
    setLabels(r.labels);
    setFrameId(null);
    keep(by, r.measurement, r.labels, r.line);
    addLog(by, `Measured ${r.line}`, 'ok');
    return r.line;
  }, [addLog, elementMap, framesRef, keep]);

  /** The live frame's references (widest mapped pair + grid cell size) become the baseline. */
  const setBaseline = useCallback(() => {
    const live = framesRef.current[0];
    if (!live) {
      addLog('Calibration', 'No captured frame — baseline not set', 'error');
      return;
    }
    const base = makeBaseline(live, elementMap());
    baselineRef.current = base;
    setBaselineState(base);
    const pair = base.a && base.b ? `"${base.a.name}" ↔ "${base.b.name}" and ` : 'no mapped pair (Point out or plan a flow to add one) — ';
    addLog('Calibration', `Baseline set: ${pair}grid cell ${Math.round(base.cellW)}×${Math.round(base.cellH)}px on ${live.srcW}×${live.srcH}`, 'ok');
  }, [addLog, elementMap, framesRef]);

  /** Applies a drifted calibration to every stored coordinate and refreshes the baseline. */
  const applyDrift = useCallback((cal: Calibration, live: Frame) => {
    rescale(cal);
    showPoints(pointsRef.current.map((p) => remapPoint(cal, p)), labels);
    setMeasurements((list) => list.map((m) => remapMeasurement(cal, m, live)));
    const base = makeBaseline(live, elementMap());
    baselineRef.current = base;
    setBaselineState(base);
  }, [elementMap, labels, rescale]);

  /** Re-measures the baseline references on the live frame; rescales stored coordinates on drift. */
  const recalibrateNow = useCallback((reason: string): Calibration | null => {
    const base = baselineRef.current;
    const live = framesRef.current[0];
    if (!base || !live) {
      addLog('Calibration', `Recalibration (${reason}) not possible — ${base ? 'no captured frame' : 'no baseline: press "Set baseline" on a known-good screen first'}; nothing rescaled`, 'error');
      return null;
    }
    try {
      const cal = recalibrate(base, live);
      setCalibration(cal);
      if (cal.drift) applyDrift(cal, live);
      addLog('Calibration', `Recalibrated (${reason}, ${cal.method}): ${cal.detail}${cal.resolutionChanged ? ' — resolution changed' : ''} — ${cal.drift ? 'drift detected, stored coordinates and measurements rescaled' : 'no drift, nothing rescaled'}`, cal.drift ? 'warn' : 'ok');
      return cal;
    } catch (error) {
      addLog('Calibration', `Recalibration failed: ${errorText(error)}`, 'error');
      return null;
    }
  }, [addLog, applyDrift, framesRef]);

  /** Records one grounding outcome; repeated failures recalibrate once automatically. */
  const noteGrounding = useCallback((out: { ok: boolean; halt?: boolean }) => {
    const { count, trigger } = tallyGrounding(failuresRef.current, out);
    failuresRef.current = count;
    if (trigger) recalibrateNow(`auto: grounding failed ${AUTO_RECALIBRATE_AFTER}× in a row`);
  }, [recalibrateNow]);

  return {
    on, toggle, points, labels, frameId, frame, measurement, measurements, baseline, calibration,
    addPoint, undo, clear, measureFrame, saveRuler, measureQuery, setBaseline, recalibrateNow, noteGrounding,
  };
}

/** The ruler's public surface, for the stage and panels. */
export type Ruler = ReturnType<typeof useMeasure>;
