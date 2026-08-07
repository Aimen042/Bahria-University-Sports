/**
 * Sport-bundle definitions.
 *
 * Each entry maps a sport name (must match sport_category.name in the DB) to
 * the ordered list of equipment items that belong to it. This is the single
 * source of truth used by:
 *   - InventoryScreen  → coordinator adds all items for a sport in one action
 *   - MyBorrowsScreen  → student requests all items for a sport in one action
 *
 * Item-level defaults (lending_unit, isIndoor) are set per item because the
 * coordinator form still needs them to call POST /api/inventory/types.
 */

export interface BundleItem {
  name: string;
  lendingUnit: 'SINGLE' | 'PAIR';
  isIndoor: boolean;
}

export interface SportBundle {
  /** Display name shown in the sport selector */
  label: string;
  /** Must match sport_category.name in the DB (case-sensitive) */
  sportName: string;
  items: BundleItem[];
}

export const SPORT_BUNDLES: SportBundle[] = [
  {
    label: 'Badminton',
    sportName: 'Badminton',
    items: [
      { name: 'Badminton Net',     lendingUnit: 'SINGLE', isIndoor: true },
      { name: 'Badminton Rackets', lendingUnit: 'PAIR',   isIndoor: true },
      { name: 'Shuttlecock',       lendingUnit: 'SINGLE', isIndoor: true },
    ],
  },
  {
    label: 'Football',
    sportName: 'Football',
    items: [
      { name: 'Football',      lendingUnit: 'SINGLE', isIndoor: false },
      { name: 'Goalpost Net',  lendingUnit: 'SINGLE', isIndoor: false },
    ],
  },
  {
    label: 'Basketball',
    sportName: 'Basketball',
    items: [
      { name: 'Basketball', lendingUnit: 'SINGLE', isIndoor: false },
    ],
  },
  {
    label: 'Cricket',
    sportName: 'Cricket',
    items: [
      { name: 'Batting Gloves', lendingUnit: 'PAIR',   isIndoor: false },
      { name: 'Batting Pads',   lendingUnit: 'PAIR',   isIndoor: false },
      { name: 'Cricket Ball',   lendingUnit: 'SINGLE', isIndoor: false },
      { name: 'Cricket Bat',    lendingUnit: 'SINGLE', isIndoor: false },
      { name: 'Helmet',         lendingUnit: 'SINGLE', isIndoor: false },
      { name: 'Wicket Set',     lendingUnit: 'SINGLE', isIndoor: false },
    ],
  },
  {
    label: 'Table Tennis',
    sportName: 'Table Tennis',
    items: [
      { name: 'Table Tennis Ball',   lendingUnit: 'SINGLE', isIndoor: true },
      { name: 'Table Tennis Net',    lendingUnit: 'SINGLE', isIndoor: true },
      { name: 'Table Tennis Racket', lendingUnit: 'PAIR',   isIndoor: true },
    ],
  },
  {
    label: 'Volleyball',
    sportName: 'Volleyball',
    items: [
      { name: 'Volleyball',     lendingUnit: 'SINGLE', isIndoor: false },
      { name: 'Volleyball Net', lendingUnit: 'SINGLE', isIndoor: false },
    ],
  },
  {
    label: 'Tennis',
    sportName: 'Tennis',
    items: [
      { name: 'Tennis Ball',   lendingUnit: 'SINGLE', isIndoor: false },
      { name: 'Tennis Net',    lendingUnit: 'SINGLE', isIndoor: false },
      { name: 'Tennis Racket', lendingUnit: 'PAIR',   isIndoor: false },
    ],
  },
];
