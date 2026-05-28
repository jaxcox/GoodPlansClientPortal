import type { Coach } from './types'

/** Resolve the brand owner's coach id for a given coach. The brand owner
 *  is the root of the manager_coach_id chain — for a 2-level hierarchy
 *  (Manager + reports) that's either the coach themselves (if they have
 *  no manager) or their manager.
 *
 *  Used at insert-time on brand-scoped tables (industries, future brand
 *  resources) so the new row is tagged with the brand it belongs to.
 *
 *  Future-proof for deeper hierarchies: walk the chain client-side via
 *  a recursive query if we ever introduce sub-teams. Today this single-
 *  step lookup is correct for everyone.
 */
export function getBrandOwnerId(coach: Coach): string {
  return coach.manager_coach_id ?? coach.id
}
