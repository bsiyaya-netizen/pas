import { useEffect, useRef, useState } from "react";

/**
 * A single-series column chart of one value per month: thin rounded columns on
 * a zero baseline, recessive gridlines, the latest value labelled directly and
 * a tooltip on hover or keyboard focus. One series, so the title names it and
 * there is no legend.
 */

export interface MonthValue {
  month: string; // YYYY-MM
  value: number;
  detail: string; // tooltip line, e.g. "3 policies, R2 950.00"
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const W = 640;
const H = 220;
const PAD = { top: 22, right: 8, bottom: 28, left: 56 };

export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split("-");
  return withYear ? `${MONTHS[Number(m) - 1]} ${y}` : MONTHS[Number(m) - 1]!;
}

/** About four round tick steps from zero to at least the maximum. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

export function MonthlyBars({
  data,
  format,
  formatTick,
  label,
}: {
  data: MonthValue[];
  format: (v: number) => string;
  formatTick: (v: number) => string;
  label: string;
}) {
  const [active, setActive] = useState<number>();
  const box = useRef<HTMLDivElement>(null);
  // On narrow screens the chart scrolls sideways; start at the latest months.
  useEffect(() => {
    if (box.current) box.current.scrollLeft = box.current.scrollWidth;
  }, []);
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const top = ticks.at(-1) || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barW = Math.min(28, slot * 0.6);
  const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / top) * plotH;
  const last = data.length - 1;
  const shown = active ?? last;

  return (
    <div className="chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "baseline" : "grid"} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="tick">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const h = PAD.top + plotH - y(d.value);
          const r = Math.min(4, h, barW / 2);
          const x0 = cx - barW / 2;
          const yb = PAD.top + plotH;
          return (
            <g key={d.month}>
              {h > 0 && (
                <path
                  className={`bar${i === active ? " active" : ""}`}
                  d={`M${x0},${yb} V${yb - h + r} Q${x0},${yb - h} ${x0 + r},${yb - h} H${x0 + barW - r} Q${x0 + barW},${yb - h} ${x0 + barW},${yb - h + r} V${yb} Z`}
                />
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="tick">
                {monthLabel(d.month)}
              </text>
              {i === shown && d.value > 0 && (
                <text x={cx} y={yb - h - 6} textAnchor="middle" className="value">
                  {format(d.value)}
                </text>
              )}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                className="hit"
                tabIndex={0}
                aria-label={`${monthLabel(d.month, true)}: ${d.detail}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(undefined)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(undefined)}
              />
            </g>
          );
        })}
      </svg>
      {active !== undefined && (
        <div
          className="tooltip"
          style={{
            left: `${((PAD.left + slot * active + slot / 2) / W) * 100}%`,
          }}
        >
          <strong>{monthLabel(data[active]!.month, true)}</strong>
          <span>{data[active]!.detail}</span>
        </div>
      )}
    </div>
  );
}
