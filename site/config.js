// Leaderboard backend. Fill in from Supabase: Project Settings → API.
// The anon / publishable key is meant to be public. The database only lets it
// call the two functions in supabase/schema.sql. Leave both empty to run the
// game without a leaderboard.
window.LEADERBOARD = {
  url: "",     // e.g. "https://abcd1234.supabase.co"
  anonKey: "", // the "anon public" key, or a "sb_publishable_..." key
};
