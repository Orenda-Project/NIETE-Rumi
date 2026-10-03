import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { HeadingTile, type Feature } from './FeatureIcon';

/**
 * bd-5rz1v.19 — the heading of a feature's MAIN page (Home, Lesson Plans, Assessment, Training,
 * Coaching): a FLAT indigo band, square corners, the status-bar area on indigo too.
 *
 *   [tile] Title ..................... [right]
 *   [context row: chips, the date range]
 *
 * Spacing from deep-screens.html "bar spacing": the title row 10px 16px 14px with 12px gaps
 * (64px with the 44px tile); the context row 10px under the title and 16px above the band's
 * edge; the band 14px above the content. Tile 44px, title 24px/800. The right slot and the
 * context row hold 56px targets whose visible shapes are smaller (a 40px avatar, a 36px pill),
 * so they take negative margins and the band keeps the mockup's height.
 *
 * Desktop (dbandF): 20px 40px 22px, centred at 1120px, a 52px tile, a 28px title with the
 * context row under it — one grid, so nothing is rendered twice.
 */
export interface MainHeadingProps {
  feature: Feature;
  title: string;
  right?: ReactNode;
  context?: ReactNode;
}

export function MainHeading({ feature, title, right, context }: MainHeadingProps) {
  return (
    <header data-testid="newui-main-heading" className="mb-[14px] bg-nu-ink pb-[2px] pt-[env(safe-area-inset-top)] text-white">
      <div
        data-testid="newui-heading-row"
        className={cn(
          'mx-auto grid max-w-[1120px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-[10px] px-4 pt-[10px]',
          context ? 'pb-4' : 'pb-[14px]',
          'md:gap-x-4 md:gap-y-2 md:px-10 md:pb-[22px] md:pt-5',
        )}
      >
        <span className="flex md:row-span-2">
          <HeadingTile feature={feature} />
        </span>
        <h1 className="col-start-2 truncate text-2xl font-extrabold tracking-[-0.015em] rtl:font-bold rtl:leading-[2] md:text-[28px]">
          {title}
        </h1>
        {right ? <div className="col-start-3 row-start-1 -my-2 flex items-center md:row-span-2">{right}</div> : null}
        {context ? (
          <div
            data-testid="newui-heading-context"
            className="col-span-3 flex flex-wrap items-center gap-1.5 md:col-span-1 md:col-start-2"
          >
            {context}
          </div>
        ) : null}
      </div>
    </header>
  );
}
