-- Only signed-in users need the admin check.
revoke execute on function public.icfr_is_admin() from anon, public;
grant execute on function public.icfr_is_admin() to authenticated;
