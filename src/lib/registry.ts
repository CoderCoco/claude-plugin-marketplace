import pluginsData from "@/data/plugins.json";
import type { PluginManifest } from "@/types/plugin";

const plugins = pluginsData as PluginManifest[];

export function getAllPlugins(): PluginManifest[] {
  return plugins;
}

export function getFeaturedPlugins(): PluginManifest[] {
  return plugins.filter((p) => p.featured);
}

export function getPluginBySlug(slug: string): PluginManifest | undefined {
  return plugins.find((p) => p.slug === slug);
}

export function getPluginsByCategory(category: string): PluginManifest[] {
  return plugins.filter((p) => p.category === category);
}

export function searchPlugins(query: string): PluginManifest[] {
  const q = query.toLowerCase();
  return plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)) ||
      p.category.toLowerCase().includes(q)
  );
}

export function getCategories(): string[] {
  const cats = new Set(plugins.map((p) => p.category));
  return Array.from(cats).sort();
}
