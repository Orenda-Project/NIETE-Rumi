/**
 * Dev-only bench page for the FLN sound player (served by Vite at
 * /src/portal/fln/player/bench/bench.html?plan=<id>[&nowarm=1]; not part of the production build).
 * The harness (tools/fln_audio_bench.py) fulfils /__fixture/plan/<id>.json with a real plan, so no plan text lives in the repo.
 * Exposes window.__flnEvents (player.onEvent) and window.__flnAudios (every element the player creates).
 */
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { FlnPlayerProvider, SoundGrid, SoundPill, itemClips, useFlnPlayer } from '../index';
import type { FlnPlanLike, FlnPlayer, FlnPlayerDeps, PlayerEvent } from '../index';

type Item = NonNullable<NonNullable<NonNullable<FlnPlanLike['sections']>[number]['groups']>[number]['items']>[number];

declare global {
  interface Window {
    __flnEvents: Array<PlayerEvent & { t: number }>;
    __flnAudios: HTMLAudioElement[];
    __flnPlayer?: FlnPlayer;
    __benchReady?: boolean;
  }
}

window.__flnEvents = window.__flnEvents || [];
window.__flnAudios = window.__flnAudios || [];

const params = new URLSearchParams(window.location.search);
const planId = params.get('plan') || '';
const noWarm = params.get('nowarm') === '1';

const deps: FlnPlayerDeps = {
  createAudio: () => {
    const a = new Audio();
    window.__flnAudios.push(a);
    return a;
  },
};

function Steps({ items, plan }: { items: Item[]; plan: FlnPlanLike }) {
  return (
    <>
      {items.map((item, i) => {
        const clips = itemClips(item, plan.lang);
        if (!clips.length) return null;
        return (
          <div className="step" key={i}>
            <div>Step {i + 1}</div>
            <div className="pills">
              {clips.map((c, j) => (
                <SoundPill key={`${c.id}-${j}`} clipId={c.id} label={c.label} caption={c.caption} lang={plan.lang} dir={plan.dir} first={i === 0 && j === 0} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Bench({ plan }: { plan: FlnPlanLike }) {
  const base = useFlnPlayer(plan, deps);
  const player = useMemo(() => {
    base.onEvent((e) => window.__flnEvents.push({ ...e, t: performance.now() }));
    const proxy = new Proxy(base, {
      get(target, key) {
        if (key === 'warm' && noWarm) return () => {};
        const v = (target as unknown as Record<PropertyKey, unknown>)[key];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    window.__flnPlayer = proxy;
    return proxy;
  }, [base]);
  useEffect(() => { window.__benchReady = true; }, []);

  return (
    <FlnPlayerProvider player={player}>
      <div dir={plan.dir || 'ltr'}>
        <h1>Bench plan {planId}{noWarm ? ' (nowarm)' : ''}</h1>
        <div data-fln-grid>
          <SoundGrid plan={plan} heading />
        </div>
        {(plan.setup || []).length > 0 && (<><h2>Setup</h2><Steps items={plan.setup || []} plan={plan} /></>)}
        {(plan.sections || []).map((s, si) => (
          <section key={si}>
            <h2>Section {si + 1}: {s.kind}</h2>
            {(s.groups || []).map((g, gi) => (
              <div key={gi}>
                {g.header ? <h3>Group {gi + 1}</h3> : null}
                <Steps items={g.items || []} plan={plan} />
              </div>
            ))}
          </section>
        ))}
        {(plan.homework || []).length > 0 && (<><h2>Homework</h2><Steps items={plan.homework || []} plan={plan} /></>)}
        {(plan.summary || []).length > 0 && (<><h2>Summary</h2><Steps items={plan.summary || []} plan={plan} /></>)}
      </div>
    </FlnPlayerProvider>
  );
}

function Loader() {
  const [plan, setPlan] = useState<FlnPlanLike | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/__fixture/plan/${encodeURIComponent(planId)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fixture ${r.status}`))))
      .then(setPlan)
      .catch((e) => setErr(String(e)));
  }, []);
  if (err) return <p>Could not load the plan fixture: {err}</p>;
  if (!plan) return <p>Loading plan {planId}…</p>;
  return <Bench plan={plan} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(<Loader />);
