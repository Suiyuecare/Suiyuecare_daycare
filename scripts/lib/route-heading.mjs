import { load } from "cheerio";

/** A real H1 may carry focus/accessibility attributes without changing its title. */
export function hasRouteHeading(html, expectedHeading) {
  const document = load(html);
  return document("h1").toArray().some((heading) =>
    document(heading).text().trim() === expectedHeading);
}
