import type { Angle, Destination, Item, Location, PublicItem, Region } from "./cabin-model";
import { boxVolume, checkDimensions, volume } from "./cabin-model";
import type { RoomItem } from "../content/initial";

function footprint(item: Item, rotation: Angle) {
  const [w, d, h] = item.props.size;
  return rotation % 180 === 0 ? [Math.ceil(w), Math.ceil(d), h] : [Math.ceil(d), Math.ceil(w), h];
}

export class Space {
  private byParent = new Map<string, Set<Item>>();
  constructor(readonly items: Map<string, Item>) {
    for (const item of items.values()) if (item.at) this.index(item, item.at.parent);
  }
  private index(item: Item, parent: string) {
    const siblings = this.byParent.get(parent) ?? new Set<Item>();
    siblings.add(item);
    this.byParent.set(parent, siblings);
  }
  protected relocate(item: Item, at: Location | null) {
    if (item.at) this.byParent.get(item.at.parent)?.delete(item);
    item.at = at;
    if (at) this.index(item, at.parent);
  }
  get(id: string) {
    const item = this.items.get(id);
    if (!item) throw Error("找不到对象 " + id);
    return item;
  }
  children(id: string, region?: string) {
    return [...(this.byParent.get(id) ?? [])].filter((i) => region === undefined || i.at!.region === region);
  }
  path(item: Item) {
    const chain = [item],
      seen = new Set([item.id]);
    while (item.at) {
      item = this.get(item.at.parent);
      if (seen.has(item.id)) throw Error("不能把对象放进自己或其后代");
      seen.add(item.id);
      chain.push(item);
    }
    return chain;
  }
  accessible(item: Item) {
    for (const child of this.path(item))
      if (child.at) {
        const parent = this.get(child.at.parent);
        this.openRegion(parent, child.at.region);
      }
  }
  reachable(item: Item) {
    return this.path(item).every((i) => {
      if (!i.at) return true;
      const parent = this.get(i.at.parent),
        region = parent.regions[i.at.region];
      return region && (!("gate" in region) || !region.gate || parent.state[region.gate] === true);
    });
  }
  openRegion(parent: Item, key: string) {
    const region = parent.regions[key];
    if (!region) throw Error(parent.props.name + " 没有区域 " + key);
    if ("gate" in region && region.gate && parent.state[region.gate] !== true)
      throw Error(parent.props.name + " 已关闭，先打开" + region.label);
    return region;
  }
  mass(item: Item): number {
    let grams = 0;
    const stack = [item];
    while (stack.length) {
      const next = stack.pop()!;
      grams += next.props.massG;
      for (const child of this.children(next.id)) stack.push(child);
    }
    return grams;
  }
  private checkLoads(item: Item) {
    for (const member of this.path(item)) {
      if (!member.at) continue;
      const parent = this.get(member.at.parent),
        region = parent.regions[member.at.region];
      const siblings = this.children(parent.id, member.at.region);
      if (region.relation === "installed") {
        if (siblings.reduce((n, i) => n + (i.props.installMB ?? 0), 0) > region.capacityMB)
          throw Error(parent.props.name + " 的安装容量不足（" + region.capacityMB + " MB）");
      } else {
        if (siblings.reduce((n, i) => n + this.mass(i), 0) > region.loadG + 1e-8)
          throw Error(parent.props.name + " 的" + region.label + "承重不足（" + region.loadG + " g）");
        if (region.relation === "inside" || region.capacityCm3 !== undefined) {
          const capacity = region.capacityCm3 ?? boxVolume(region.size);
          if (siblings.reduce((n, i) => n + volume(i.props), 0) > capacity + 1e-8)
            throw Error(region.label + "的可用容积不足");
        }
      }
    }
  }
  private fit(item: Item, parent: Item, dest: Destination, region: Region): Location {
    const base = { parent: parent.id, region: dest.region };
    if (region.relation === "installed") {
      if (!item.props.installMB) throw Error("安装位只接受有安装大小的软件");
      if (dest.x || dest.y || dest.rotation) throw Error("软件安装位按 MB 分配，没有网格坐标");
      return { ...base, x: 0, y: 0, rotation: 0 };
    }
    if (item.props.installMB) throw Error("软件需要安装在设备的软件安装位");
    const [rw, rd, rh] = region.size;
    const angles = dest.rotation === undefined ? item.props.rotations : [dest.rotation];
    const occupied = this.children(parent.id, dest.region)
      .filter((i) => i.id !== item.id)
      .map((i) => {
        const [w, d] = footprint(i, i.at!.rotation);
        return { x: i.at!.x, y: i.at!.y, w, d };
      });
    let reason = "区域里没有足够的连续空间";
    for (const angle of angles) {
      if (!item.props.rotations.includes(angle)) throw Error("此物品不允许朝向 " + angle + "°");
      const [w, d, h] = footprint(item, angle);
      if (h > rh || w > rw || d > rd) {
        reason = "物品尺寸超过" + region.label + "的净尺寸";
        continue;
      }
      const width = item.props.size[angle % 180 === 0 ? 0 : 1];
      if (region.opening && (width > region.opening[0] || h > region.opening[1])) {
        reason = "物品无法通过" + region.label + "的开口";
        continue;
      }
      const x0 = dest.x === undefined ? 0 : Math.round(dest.x),
        y0 = dest.y === undefined ? 0 : Math.round(dest.y);
      if (x0 < 0 || y0 < 0 || x0 + w > rw || y0 + d > rd) {
        reason = "指定位置超出" + region.label + "边界";
        continue;
      }
      for (let y = y0; y <= (dest.y === undefined ? rd - d : y0); y++) {
        for (let x = x0; x <= (dest.x === undefined ? rw - w : x0);) {
          const hit = occupied.find((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.d && y + d > o.y);
          if (!hit) return { ...base, x, y, rotation: angle };
          reason = dest.x === undefined ? "区域里没有足够的连续空间" : "指定位置已被其他物品占用";
          x = hit.x + hit.w;
        }
      }
    }
    throw Error(parent.props.name + "：" + reason);
  }
  place(item: Item, dest: Destination, searchOnly = false) {
    if (item.id === "cabin") throw Error("小屋地面是坐标原点");
    const parent = this.get(dest.parent);
    if (this.path(parent).includes(item)) throw Error("不能把对象放进自己或其后代");
    this.accessible(item);
    this.accessible(parent);
    const at = this.fit(item, parent, dest, this.openRegion(parent, dest.region));
    const old = item.at;
    this.relocate(item, at);
    try {
      this.checkLoads(item);
    } catch (error) {
      this.relocate(item, old);
      throw error;
    }
    if (searchOnly) this.relocate(item, old);
    return at;
  }
  validateEdit(item: Item) {
    checkDimensions(item.props, item.regions);
    for (const i of [item, ...this.children(item.id)]) {
      if (!i.at) continue;
      const parent = this.get(i.at.parent),
        region = parent.regions[i.at.region];
      if (!region) throw Error("仍有物品占用区域 " + i.at.region);
      this.fit(i, parent, i.at, region);
      this.checkLoads(i);
    }
  }
  worldXY(item: Item): [number, number] {
    // Translate local origins and rotate each child rectangle about its parent's origin.
    let [x, y] = [0, 0],
      [w, d] = item.props.size;
    for (const member of this.path(item)) {
      if (!member.at) break;
      const [mw, md] = member.props.size;
      switch (member.at.rotation) {
        case 90:
          [x, y] = [md - y - d, x];
          [w, d] = [d, w];
          break;
        case 180:
          [x, y] = [mw - x - w, md - y - d];
          break;
        case 270:
          [x, y] = [y, mw - x - w];
          [w, d] = [d, w];
          break;
      }
      x += member.at.x;
      y += member.at.y;
    }
    return [x, y];
  }
  scene(projection?: PublicItem[]): RoomItem[] {
    const visible = projection && new Set(projection.map((i) => i.id));
    const room: RoomItem[] = [];
    for (const item of this.items.values()) {
      if (
        !item.art ||
        (visible && (!visible.has(item.id) || item.visibility !== "detail")) ||
        this.path(item).at(-1)?.id !== "cabin"
      )
        continue;
      const [x, y] = this.worldXY(item);
      room.push({ id: item.id, kind: item.art.kind, x: x / 10 + item.art.dx, y: y / 10 + item.art.dy });
    }
    return room;
  }
  publicItems(): PublicItem[] {
    const result: PublicItem[] = [];
    const visit = (item: Item) => {
      if (item.visibility === "hidden" || (item.source && item.source.scope !== "public")) return;
      const region = item.at && this.get(item.at.parent).regions[item.at.region];
      const full = item.visibility === "detail";
      const chain = this.path(item);
      const onDisplay =
        full &&
        item.at &&
        !item.art &&
        chain.every(
          (i) => !i.at || ["on", "hang"].includes(this.get(i.at.parent).regions[i.at.region].relation),
        );
      let marker: PublicItem["marker"];
      if (onDisplay) {
        const [x, y] = this.worldXY(item),
          host = chain.find((i) => i.art)?.art;
        marker = {
          x: (x + item.props.size[0] / 2) / 10 + (host?.dx ?? 0),
          y: y / 10 + (host ? host.dy - 12 : 0),
        };
      }
      result.push({
        id: item.id,
        name: item.props.name,
        color: item.props.color,
        marker,
        ...(full ? { description: item.props.description, size: item.props.size } : {}),
        ...(item.at && region
          ? {
              at: {
                ...(full ? item.at : { parent: item.at.parent, region: item.at.region }),
                label: region.label,
                relation: region.relation,
              },
            }
          : {}),
        ...(full &&
        Object.values(item.regions).some((r) => "gate" in r && r.gate && item.state[r.gate] !== true)
          ? { closed: true }
          : {}),
      });
      if (full)
        for (const child of this.children(item.id)) {
          const r = item.regions[child.at!.region];
          if (r && (!("gate" in r) || !r.gate || item.state[r.gate] === true)) visit(child);
        }
    };
    visit(this.get("cabin"));
    return result;
  }
}
