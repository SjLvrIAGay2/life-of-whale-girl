// Stable routes used by file-based handlers, signed sync and already published links.
const life = "/api/v1/life/";
export const routes = {
  life: life,
  homeData: life + "home",
  activityData: life + "activity",
  workHistory: life + "work-history",
  revisions: life + "revisions",
  mirror: "/internal/mirror",
  feed: "/feed.xml",
  manage: "/manage",
  preview: "/preview",
  picture: "/picture/",
  activity: "/activity/",
  journal: "/journal/",
};
