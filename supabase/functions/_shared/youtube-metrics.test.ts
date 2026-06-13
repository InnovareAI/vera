import { parseYouTubeVideoId, youtubeStatisticsToMetrics } from "./youtube-metrics.ts"

Deno.test("parseYouTubeVideoId handles common public URL formats", () => {
  assertEquals(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ")
  assertEquals(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=42"), "dQw4w9WgXcQ")
  assertEquals(parseYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
  assertEquals(parseYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
  assertEquals(parseYouTubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ")
})

Deno.test("youtubeStatisticsToMetrics normalizes visible counters", () => {
  const metrics = youtubeStatisticsToMetrics({
    viewCount: "1234",
    likeCount: "56",
    commentCount: 7,
    favoriteCount: "0",
  })

  assertEquals(metrics.views, 1234)
  assertEquals(metrics.likes, 56)
  assertEquals(metrics.comments, 7)
  assertEquals(metrics.favorites, 0)
})

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
