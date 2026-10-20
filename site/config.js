// Leaderboard backend. Fill in from Supabase: Project Settings → API.
// The anon / publishable key is meant to be public. The database only lets it
// call the two functions in supabase/schema.sql. Leave both empty to run the
// game without a leaderboard.
window.LEADERBOARD = {
  url: "https://refdymkuoorwguiajspl.supabase.co",
  anonKey: "sb_publishable_T0_87p-ptb5YrzIzEF2m2w_mkHaI9Ya", // the "anon public" key, or a "sb_publishable_..." key
};
