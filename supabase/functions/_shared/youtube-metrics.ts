export type YoutubeMetricCounts = {
  views: number | null
  likes: number | null
  comments: number | null
  favorites: number | null
}

export function parseYouTubeVideoId(input: string | null | undefined): string | null {
  if (!input) return null
  const raw = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw

  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    if (host === "youtu.be") {
      return normalizeVideoId(url.pathname.split("/").filter(Boolean)[0])
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const watch = normalizeVideoId(url.searchParams.get("v"))
      if (watch) return watch

      const parts = url.pathname.split("/").filter(Boolean)
      const markerIndex = parts.findIndex(part => ["shorts", "embed", "live", "v"].includes(part.toLowerCase()))
      if (markerIndex >= 0) return normalizeVideoId(parts[markerIndex + 1])
    }
  } catch {
    const loose = raw.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/)?.[1]
    return normalizeVideoId(loose)
  }

  return null
}

export function youtubeStatisticsToMetrics(statistics: unknown): YoutubeMetricCounts {
  const stats = recordValue(statistics)
  return {
    views: countValue(stats.viewCount),
    likes: countValue(stats.likeCount),
    comments: countValue(stats.commentCount),
    favorites: countValue(stats.favoriteCount),
  }
}

function normalizeVideoId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? trimmed : null
}

function countValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""))
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed)
  }
  return null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
