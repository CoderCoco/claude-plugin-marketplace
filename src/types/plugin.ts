export type PluginCategory =
  | "productivity"
  | "developer-tools"
  | "data-analysis"
  | "communication"
  | "utilities"
  | "research"
  | "finance"
  | "creativity";

export interface PluginAuthor {
  name: string;
  url?: string;
  email?: string;
}

export interface PluginTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface PluginManifest {
  /** Unique slug identifier for the plugin */
  slug: string;
  name: string;
  description: string;
  longDescription?: string;
  version: string;
  category: PluginCategory;
  tags: string[];
  author: PluginAuthor;
  /** Icon emoji or URL */
  icon: string;
  homepage?: string;
  repository?: string;
  license: string;
  /** How to install / run the plugin */
  installCommand: string;
  /** MCP server configuration for Claude */
  mcpConfig: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  tools: PluginTool[];
  /** ISO date string */
  publishedAt: string;
  updatedAt: string;
  downloads?: number;
  rating?: number;
  ratingCount?: number;
  featured?: boolean;
}
