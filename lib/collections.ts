import { plain, type Observation, type ReadRequest, type Story } from "./media";

type Reader = (url: URL) => Promise<string>;
async function museum(q: ReadRequest, read: Reader): Promise<Observation> {
  const open = q.action === "open";
  if (open && !/^\d{1,10}$/.test(q.id || "")) throw Error("invalid_artwork");
  const url = new URL("https://openaccess-api.clevelandart.org/api/artworks/" + (open ? q.id : ""));
  if (!open) {
    url.searchParams.set("q", q.query || "ocean");
    url.searchParams.set("limit", "6");
    url.searchParams.set("skip", String(((q.page || 1) - 1) * 6));
    url.searchParams.set("fields", "id,title,url");
  }
  const { data } = JSON.parse(await read(url));
  const items: Story[] = (open ? [data] : data)
    .filter(
      (x: any) =>
        x &&
        Number.isSafeInteger(x.id) &&
        x.title &&
        /^https:\/\/(www\.)?clevelandart\.org\/art\//.test(x.url),
    )
    .map((x: any) => ({
      id: String(x.id),
      title: plain(x.title, 160),
      url: x.url,
      body: open
        ? [x.creation_date, x.technique, x.description || x.did_you_know, x.creditline]
            .map((v) => plain(v, 1200))
            .filter(Boolean)
            .join("\n")
        : "",
      ...(open &&
      x.share_license_status === "CC0" &&
      /^https:\/\/openaccess-cdn\.clevelandart\.org\//.test(x.images?.web?.url)
        ? { image: x.images.web.url }
        : {}),
    }));
  return { status: items.length ? "ok" : "no_results", level: open ? "collection_label" : "title", items };
}
async function nasa(q: ReadRequest, read: Reader): Promise<Observation> {
  const open = q.action === "open";
  if (open && !/^[\w.-]{1,100}$/.test(q.id || "")) throw Error("invalid_nasa_id");
  const url = new URL("https://images-api.nasa.gov/search");
  url.searchParams.set(open ? "nasa_id" : "q", (open ? q.id : q.query) || "moon");
  url.searchParams.set("media_type", "image");
  url.searchParams.set("page_size", open ? "1" : "6");
  if (!open) url.searchParams.set("page", String(q.page || 1));
  const { collection } = JSON.parse(await read(url));
  const items: Story[] = collection.items.flatMap((entry: any) => {
    const x = entry.data?.[0];
    if (!x || !/^[\w.-]{1,100}$/.test(x.nasa_id) || (open && x.nasa_id !== q.id)) return [];
    const image = entry.links?.find(
      (l: any) =>
        l.rel === "preview" && l.render === "image" && /^https:\/\/images-assets\.nasa\.gov\//.test(l.href),
    )?.href;
    return [
      {
        id: x.nasa_id,
        title: plain(x.title, 150),
        url: "https://images.nasa.gov/details/" + encodeURIComponent(x.nasa_id),
        body: open ? plain(x.description, 1800) : "",
        ...(open && image ? { image } : {}),
      },
    ];
  });
  return { status: items.length ? "ok" : "no_results", level: open ? "photo_caption" : "title", items };
}
export const collections = { museum, nasa };
