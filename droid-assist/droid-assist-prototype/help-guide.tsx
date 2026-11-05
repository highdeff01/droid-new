import { useMemo, useState } from 'react';
import { GUIDE, guideFeatureCount, searchGuide, type GuideHit } from './guide.js';
import styles from './droid-assist.module.css';

/** One feature as a walkthrough: name, summary and numbered steps. */
function FeatureEntry({ hit, open, onToggle }: { hit: GuideHit; open: boolean; onToggle: () => void }) {
  const { feature } = hit;
  return (
    <li className={styles.guideFeature}>
      <button type="button" className={styles.guideFeatureHead} onClick={onToggle} aria-expanded={open}>
        <strong>{feature.name}</strong>
        <small>{feature.summary}</small>
      </button>
      {open && (
        <ol className={styles.guideSteps}>
          {feature.how.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      )}
    </li>
  );
}

/**
 * Help → User guide: the full feature set, searchable, with a per-feature walkthrough. It reads only
 * the static guide, so it works with no engine and no capture.
 */
export function HelpGuide() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const hits = useMemo(() => searchGuide(query), [query]);
  const total = guideFeatureCount();
  const key = (h: GuideHit) => `${h.section.id}/${h.feature.name}`;
  /** Sections with at least one hit, in guide order, each with its hits. */
  const bySection = useMemo(() => GUIDE
    .map((section) => ({ section, hits: hits.filter((h) => h.section.id === section.id) }))
    .filter((s) => s.hits.length > 0), [hits]);

  return (
    <section className={styles.panel}>
      <h3>User guide <small>{total} features documented</small></h3>
      <label className={styles.setting}>
        <input
          type="search"
          value={query}
          placeholder="Search the guide — e.g. voice, bridge, triggers"
          aria-label="Search the user guide"
          onChange={(e) => setQuery(e.target.value)}
        />
        <small>{query.trim() ? `${hits.length} of ${total} features match “${query.trim()}”` : 'Type to filter; click a feature for its walkthrough.'}</small>
      </label>
      {bySection.length === 0 && <p className={styles.muted}>No feature matches “{query.trim()}”. Try a shorter word.</p>}
      {bySection.map(({ section, hits: sectionHits }) => (
        <div key={section.id} className={styles.guideSection}>
          <h4>{section.title}</h4>
          <p className={styles.muted}>{section.intro}</p>
          <ul className={styles.guideList}>
            {sectionHits.map((hit) => (
              <FeatureEntry key={key(hit)} hit={hit} open={open === key(hit)} onToggle={() => setOpen((k) => (k === key(hit) ? null : key(hit)))} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
