import { useEffect, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { TRANSITION_STYLE, playbackAt, type Slideshow } from './slideshow.js';
import { movieFrameAt, movieDuration, type Movie } from './movie.js';
import styles from './droid-assist.module.css';

/** Milliseconds since mount, ticking every `stepMs` (players are keyed by what they play, so a new one restarts). */
function useElapsed(stepMs = 100): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now - start;
}

/** Plays a slideshow in-app: each slide enters with its transition; stops at the end. */
function SlideshowPlayer({ show }: { show: Slideshow }) {
  const at = playbackAt(show, useElapsed());
  if (!at) return <p className={styles.muted}>End of &quot;{show.name}&quot;.</p>;
  const slide = show.slides[at.index];
  return (
    <figure aria-label={`Slide ${at.index + 1} of ${show.slides.length}`} style={{ overflow: 'hidden', margin: 0 }}>
      <div style={{ ...TRANSITION_STYLE[slide.transition](at.transition) }}>
        <h4>{slide.title}</h4>
        {slide.image && <img src={slide.image} alt={slide.title} width={320} />}
        <ul>
          {slide.notes.map((n, i) => <li key={`n${i}`}>{n}</li>)}
          {slide.research.map((r, i) => <li key={`r${i}`}><i>{r.text}</i>{r.source && <small> — {r.source}</small>}</li>)}
        </ul>
      </div>
      <progress value={at.progress} max={1} />
    </figure>
  );
}

/** Plays a movie in-app: the current shot, cross-faded into the next, with its caption. */
function MoviePlayer({ movie }: { movie: Movie }) {
  const elapsed = useElapsed(1000 / movie.fps);
  if (elapsed >= movieDuration(movie)) return <p className={styles.muted}>End of &quot;{movie.name}&quot;.</p>;
  const f = movieFrameAt(movie, elapsed);
  const next = f.next === null ? null : movie.shots[f.next];
  return (
    <figure aria-label={`Movie ${movie.name}`} style={{ position: 'relative', width: 320, height: 180, margin: 0, overflow: 'hidden' }}>
      <img src={movie.shots[f.shot].image} alt="" width={320} height={180} style={{ position: 'absolute', transform: `scale(${f.zoom})` }} />
      {next && <img src={next.image} alt="" width={320} height={180} style={{ position: 'absolute', opacity: f.alpha }} />}
      {f.caption && <figcaption style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,.6)', color: '#fff' }}>{f.caption}</figcaption>}
    </figure>
  );
}

/** The presentation studio: player, saved slideshows and movies, pending approvals, projects and the world embed. */
export function PresentationPanel({ engine }: { engine: AssistEngine }) {
  const s = engine.studio;
  const show = s.playing?.kind === 'slideshow' ? s.slideshows.find((x) => x.id === s.playing?.id) : undefined;
  const movie = s.playing?.kind === 'movie' ? s.movies.find((x) => x.id === s.playing?.id) : undefined;
  return (
    <section className={styles.panel} aria-label="Presentation studio">
      <h3>Presentation studio <small>slideshow.build · movie.render · /do</small></h3>
      {show && <SlideshowPlayer key={show.id} show={show} />}
      {movie && <MoviePlayer key={movie.id} movie={movie} />}
      {s.playing && <button type="button" onClick={() => s.setPlaying(null)}>Stop playback</button>}
      <h4>Awaiting approval</h4>
      {!s.approvals.length && <p className={styles.muted}>No AI compositions waiting.</p>}
      <ul className={styles.log}>
        {s.approvals.map((a) => (
          <li key={a.id} data-tone="warn">{a.briefing}{' '}
            <button type="button" onClick={() => void s.approve(a.id)}>Approve</button>
            <button type="button" onClick={() => s.reject(a.id)}>Reject</button>
          </li>
        ))}
      </ul>
      <h4>Slideshows</h4>
      {!s.slideshows.length && <p className={styles.muted}>None yet.</p>}
      <ul className={styles.log}>
        {s.slideshows.map((x) => (
          <li key={x.id} data-tone={x.status === 'verified' ? 'ok' : 'warn'}><b>{x.name}</b> <small>{x.status} · {x.slides.length} slide(s)</small>{' '}
            <button type="button" onClick={() => s.setPlaying({ kind: 'slideshow', id: x.id })}>Play</button>
            <button type="button" onClick={() => void s.exportOutput(x.id)}>Export HTML</button>
            <button type="button" onClick={() => s.embedOutput(x.id)}>Show in demo world</button>
          </li>
        ))}
      </ul>
      <h4>Movies</h4>
      {!s.movies.length && <p className={styles.muted}>None yet.</p>}
      <ul className={styles.log}>
        {s.movies.map((x) => (
          <li key={x.id} data-tone={x.status === 'verified' ? 'ok' : 'warn'}><b>{x.name}</b> <small>{x.status} · {x.shots.length} shot(s)</small>{' '}
            <button type="button" onClick={() => s.setPlaying({ kind: 'movie', id: x.id })}>Play</button>
            <button type="button" onClick={() => void s.exportOutput(x.id)}>Export webm</button>
            <button type="button" onClick={() => s.embedOutput(x.id)}>Show in demo world</button>
          </li>
        ))}
      </ul>
      <h4>Projects</h4>
      {!s.projects.length && <p className={styles.muted}>No projects yet — presentation.add-to-project creates one.</p>}
      <ul className={styles.log}>
        {s.projects.map((p) => <li key={p.id}><b>{p.name}</b> <small>{p.presentations.map((r) => `${r.name} (${r.kind})`).join(', ')}</small></li>)}
      </ul>
      {s.embed && <p>In the demo world: <b>{s.embed.title}</b> <button type="button" onClick={s.clearEmbed}>Remove</button></p>}
    </section>
  );
}
