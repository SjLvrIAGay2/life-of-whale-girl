import type { PublicItem } from "../lib/cabin-model";

export function CabinMarkers({ items }: { items: PublicItem[] }) {
  const groups = new Map<string, PublicItem[]>();
  for (const item of items)
    if (item.marker) {
      const key = Math.round(item.marker.x / 12) + "," + Math.round(item.marker.y / 9);
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
  return (
    <div className="cabin-markers">
      {[...groups.values()].map((group) => {
        const item = group.at(-1)!;
        const reveal = (button: HTMLButtonElement) => {
          const row = button
            .closest("figure")
            ?.querySelector<HTMLElement>(
              '[data-object-id="' + CSS.escape(item.id) + '"] > details > summary',
            );
          if (!row) return;
          for (let node = row.parentElement; node && node.tagName !== "FIGURE"; node = node.parentElement)
            if (node instanceof HTMLDetailsElement) node.open = true;
          row.focus();
        };
        return (
          <button
            type="button"
            key={item.id}
            onClick={(event) => reveal(event.currentTarget)}
            style={{
              left: Math.max(8, Math.min(92, item.marker!.x)) + "%",
              top: Math.max(6, Math.min(94, item.marker!.y)) + "%",
            }}
            aria-label={"查看" + item.name}
          >
            {item.name}
            {group.length > 1 && <small> +{group.length - 1}</small>}
          </button>
        );
      })}
    </div>
  );
}

const relations = { on: "摆在", inside: "装在", hang: "挂在", part: "装配在", installed: "安装在" };
export function CabinInventory({ items }: { items: PublicItem[] }) {
  const groups = new Map<string, PublicItem[]>();
  for (const item of items)
    if (item.at) {
      const list = groups.get(item.at.parent) ?? [];
      list.push(item);
      groups.set(item.at.parent, list);
    }
  function row(item: PublicItem) {
    const children = groups.get(item.id) ?? [],
      at = item.at;
    const location = at && relations[at.relation] + at.label;
    return (
      <li key={item.id} data-object-id={item.id}>
        <details>
          <summary>
            <span className="cabin-swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
            <strong>{item.name}</strong>
            <span className="cabin-location">
              {location}
              {item.closed ? " · 已关闭" : children.length ? " · " + children.length + " 件" : ""}
            </span>
          </summary>
          {item.description && <p>{item.description}</p>}
          <p className="cabin-measures">
            {item.size && <span>{item.size.join(" × ")} cm</span>}
            {at?.x !== undefined && at.relation !== "installed" && (
              <span>
                局部位置 ({at.x}, {at.y}) cm · {at.rotation}°
              </span>
            )}
            <span>编号 {item.id}</span>
          </p>
          {children.length > 0 && <ul>{children.map(row)}</ul>}
        </details>
      </li>
    );
  }
  return (
    <details className="cabin-inventory">
      <summary>
        小屋里的物品 <span>{items.length - 1} 件</span>
      </summary>
      <ul>{groups.get("cabin")?.map(row)}</ul>
    </details>
  );
}
