/**
 * A catalogue string with `{slot}`s, drawn with each value inside <bdi> in the chrome's digits, so a
 * number or a Latin run never takes its direction from the Urdu around it (language-protocol §8–9).
 */
import { Fragment } from 'react';
import { num, type ShareLang } from './strings.share';

export function Fill({ text, values, lang }: { text: string; values: Record<string, number | string>; lang: ShareLang }) {
  const parts = text.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{(\w+)\}$/.exec(p);
        if (m && m[1] in values) return <bdi key={i}>{num(values[m[1]], lang)}</bdi>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
