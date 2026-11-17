import { createRoot } from "react-dom/client";
import { Home } from "../app/home";
import { fetchPublicPage } from "../lib/fetch-public-page";
const shell = document.getElementById("root")!;
async function start() {
  const [page = "home", id] = location.pathname.split("/").filter(Boolean);
  const q = new URLSearchParams(location.search);
  if (page === "gallery" || page === "journal") q.set("archive", page);
  if (page === "activity" && id) q.set("activity", id);
  if (page === "days") q.set("archive", "activities");
  if (page === "journal" && id) q.set("day", id);
  const initial = await fetchPublicPage(q);
  document.title = initial.name;
  createRoot(shell).render(<Home initial={initial} page={page} day={id} search={q.toString()} live />);
}
start().catch((e) => {
  shell.textContent = e.message;
});
