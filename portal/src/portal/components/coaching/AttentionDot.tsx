/** bd-5rz1v — a red dot with a ring pulsing out of it: "this needs you". */
const AttentionDot = ({ size = 26 }: { size?: number }) => (
  <span aria-hidden="true" className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
    <span className="absolute inset-0 rounded-full bg-[rgba(239,83,80,0.55)] animate-attention-ring motion-reduce:hidden" />
    <span className="relative rounded-full bg-[#ef5350]" style={{ width: size * 0.54, height: size * 0.54 }} />
  </span>
);

export default AttentionDot;
