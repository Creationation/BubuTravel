-- ============================================================================
-- BuBuTravel  |  migration 003
-- Verrouille share_owner, qui restait appelable par les visiteurs.
-- ============================================================================

-- Postgres accorde EXECUTE a PUBLIC sur toute fonction nouvellement creee.
-- La migration 002 revoquait le droit a anon et authenticated, mais ces roles
-- l'heritaient encore de PUBLIC : la fonction restait appelable et revelait
-- l'uuid du proprietaire a qui possedait un jeton. Il faut revoquer PUBLIC.
revoke execute on function public.share_owner(text) from public;
revoke execute on function public.share_owner(text) from anon, authenticated;

-- Les fonctions de lecture partagee gardent leur acces explicite. Elles sont
-- security definer, donc leur appel interne a share_owner passe toujours.
grant execute on function public.shared_profile(text) to anon, authenticated;
grant execute on function public.shared_places(text)  to anon, authenticated;
grant execute on function public.shared_trips(text)   to anon, authenticated;
grant execute on function public.shared_photos(text)  to anon, authenticated;
grant execute on function public.shared_tracks(text)  to anon, authenticated;
