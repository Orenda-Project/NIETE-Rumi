import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { HeadingTile, type Feature } from './FeatureIcon';
import { DESK_COLUMN } from './styles';

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
 * Desktop (dbandF): a 52px tile, a 28px title with the context row under it — one grid, so
 * nothing is rendered twice.
 *
 * bd-5rz1v.32 — on a desktop the band is a CARD under the menu, no longer one indigo block with
 * the top bar (operator, from the v13 "card-24" mockup): the header stands in the page's column
 * (DESK_COLUMN: 1040px at 1280, a 40px gutter below 1120), 24px under the menu and 24px above the
 * content, and the title row is the indigo card — 20px corners, 20px 32px 24px. Phone: unchanged.
 */
export interface MainHeadingProps {
  feature: Feature;
  title: string;
  right?: ReactNode;
  context?: ReactNode;
}

export function MainHeading({ feature, title, right, context }: MainHeadingProps) {
  return (
    <header
      data-testid="newui-main-heading"
      className={cn(
        'mb-[14px] bg-nu-ink pb-[2px] pt-[env(safe-area-inset-top)] text-white',
        DESK_COLUMN,
        'md:my-6 md:bg-transparent md:pb-0 md:pt-0',
      )}
    >
      <div
        data-testid="newui-heading-row"
        className={cn(
          '[display:grid] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-[10px] px-4 pt-[10px]',
          context ? 'pb-4' : 'pb-[14px]',
          'md:gap-x-4 md:gap-y-2 md:rounded-[20px] md:bg-nu-ink md:px-8 md:pb-6 md:pt-5',
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
