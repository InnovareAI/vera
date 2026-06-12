import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  Bookmark,
  Clock3,
  Eye,
  Globe2,
  Heart,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  Smile,
  ThumbsUp,
} from 'lucide-react'
import type { Post } from '../lib/supabase'
import { color, radius, shadow, type as t } from '../design'

type PlatformKind = 'instagram' | 'linkedin' | 'x' | 'facebook' | 'tiktok' | 'youtube' | 'reddit' | 'quora' | 'medium' | 'email' | 'blog' | 'generic'
type Density = 'compact' | 'standard' | 'spacious'
type MediaFrame = { url: string; text?: string | null }

type PlatformPostPreviewProps = {
  post: Post
  className?: string
  style?: CSSProperties
  density?: Density
  autoplayMedia?: boolean
  showSpec?: boolean
  showCommentField?: boolean
}

const platformAccent: Record<PlatformKind, string> = {
  instagram: color.dotPink,
  linkedin: color.dotBlue,
  x: color.dotSky,
  facebook: 'var(--dot-indigo)',
  tiktok: '#111111',
  youtube: color.danger,
  reddit: '#ea580c',
  quora: '#b92b27',
  medium: color.dotViolet,
  email: 'var(--dot-emerald)',
  blog: color.dotViolet,
  generic: color.ghost,
}

export function PlatformPostPreview({
  post,
  className,
  style,
  density = 'standard',
  autoplayMedia = false,
  showSpec = true,
  showCommentField = true,
}: PlatformPostPreviewProps) {
  const platform = normalizePlatform(post.channel)
  const profile = previewProfile()
  const copy = copyWithoutSubject(post.copy ?? '')
  const tags = normalizeTags(post.hashtags).filter(tag => !copy.includes(tag))
  const spec = creativeSpec(post, platform)
  const shellStyle: CSSProperties = {
    width: '100%',
    maxWidth: platform === 'youtube' ? 720 : platform === 'x' ? 600 : platform === 'instagram' || platform === 'tiktok' ? 480 : 640,
    margin: '0 auto',
    fontFamily: t.family.sans,
    color: color.ink,
    background: color.surface,
    border: `1px solid ${color.line}`,
    borderRadius: density === 'compact' ? radius.md : radius.lg,
    overflow: 'hidden',
    boxShadow: density === 'compact' ? 'none' : shadow.pop,
    ...style,
  }

  if (platform === 'instagram' || platform === 'tiktok') {
    return (
      <article className={className} style={shellStyle}>
        <PreviewHeader platform={platform} profile={profile} density={density} />
        <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} />
        <InstagramActions platform={platform} />
        <CaptionBlock profileName={profile.name} copy={copy} tags={tags} density={density} />
        {showCommentField && <CommentField placeholder="Add a comment..." density={density} />}
        {showSpec && <CreativeSpec spec={spec} />}
      </article>
    )
  }

  if (platform === 'x') {
    return (
      <article className={className} style={{ ...shellStyle, padding: density === 'compact' ? 14 : 18 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Avatar profile={profile} size={44} platform={platform} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <XHeader profile={profile} />
            <PostText copy={copy} tags={tags} density={density} />
            <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} framed />
            <div style={{ display: 'flex', gap: 22, paddingTop: 12, color: color.ghost, fontSize: t.size.cap }}>
              <Metric icon={<MessageCircle size={16} />} label="Reply" />
              <Metric icon={<Repeat2 size={16} />} label="Repost" />
              <Metric icon={<Heart size={16} />} label="Like" />
              <Metric icon={<Share2 size={16} />} label="Share" />
            </div>
            {showCommentField && <CommentField placeholder="Post your reply" density={density} compact />}
            {showSpec && <CreativeSpec spec={spec} />}
          </div>
        </div>
      </article>
    )
  }

  if (platform === 'email') {
    return (
      <article className={className} style={shellStyle}>
        <EmailHeader post={post} profile={profile} />
        <div style={{ padding: density === 'compact' ? 14 : 18 }}>
          <PostText copy={copy} tags={tags} density={density} />
          <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} framed />
          {showCommentField && <CommentField placeholder="Write a reply..." density={density} icon={<Mail size={15} />} />}
          {showSpec && <CreativeSpec spec={spec} />}
        </div>
      </article>
    )
  }

  if (platform === 'youtube') {
    return (
      <article className={className} style={shellStyle}>
        <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} />
        <div style={{ padding: density === 'compact' ? 14 : 18 }}>
          <h2 style={{ margin: '0 0 8px', color: color.ink, fontSize: density === 'compact' ? t.size.body : t.size.h3, lineHeight: 1.2 }}>{post.title || subjectFromCopy(post.copy) || 'Untitled video'}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Avatar profile={profile} size={36} platform={platform} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{profile.name}</div>
              <div style={{ color: color.ghost, fontSize: t.size.cap }}>{profile.handle} · 0 subscribers preview</div>
            </div>
          </div>
          <PostText copy={copy} tags={tags} density={density} />
          <PlatformActionRow
            actions={[
              { icon: <ThumbsUp size={16} />, label: 'Like' },
              { icon: <MessageCircle size={16} />, label: 'Comment' },
              { icon: <Share2 size={16} />, label: 'Share' },
            ]}
          />
          {showCommentField && <CommentField placeholder="Add a comment..." density={density} />}
          {showSpec && <CreativeSpec spec={spec} />}
        </div>
      </article>
    )
  }

  if (platform === 'reddit' || platform === 'quora') {
    const isQuora = platform === 'quora'
    return (
      <article className={className} style={shellStyle}>
        <div style={{ padding: density === 'compact' ? 14 : 18, borderBottom: `1px solid ${color.line}`, background: color.paper2 }}>
          <div style={{ color: platformAccent[platform], fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide, fontWeight: t.weight.semibold }}>
            {isQuora ? 'Quora answer preview' : 'Reddit discussion preview'}
          </div>
          <h2 style={{ margin: '8px 0 0', color: color.ink, fontSize: density === 'compact' ? t.size.body : t.size.h4, lineHeight: 1.25 }}>{post.title || subjectFromCopy(post.copy) || (isQuora ? 'Draft answer' : 'Draft discussion')}</h2>
        </div>
        <div style={{ padding: density === 'compact' ? 14 : 18 }}>
          <PostText copy={copy} tags={tags} density={density} />
          <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} framed />
          <PlatformActionRow
            actions={isQuora
              ? [
                  { icon: <ThumbsUp size={16} />, label: 'Upvote' },
                  { icon: <MessageCircle size={16} />, label: 'Comment' },
                  { icon: <Share2 size={16} />, label: 'Share' },
                ]
              : [
                  { icon: <ThumbsUp size={16} />, label: 'Upvote' },
                  { icon: <MessageCircle size={16} />, label: 'Comment' },
                  { icon: <Share2 size={16} />, label: 'Share' },
                ]}
          />
          {showCommentField && <CommentField placeholder={isQuora ? 'Add a comment...' : 'Join the thread...'} density={density} />}
          {showSpec && <CreativeSpec spec={spec} />}
        </div>
      </article>
    )
  }

  if (platform === 'blog') {
    return (
      <article className={className} style={shellStyle}>
        <div style={{ padding: density === 'compact' ? 14 : 20, borderBottom: `1px solid ${color.line}` }}>
          <div style={{ fontSize: t.size.micro, color: color.ghost, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide, fontWeight: t.weight.semibold }}>Article preview</div>
          <h2 style={{ margin: '8px 0 4px', color: color.ink, fontSize: density === 'compact' ? t.size.h4 : t.size.h3, lineHeight: 1.2 }}>{post.title || subjectFromCopy(post.copy) || 'Untitled article'}</h2>
          <div style={{ color: color.ghost, fontSize: t.size.cap }}>By {profile.name} · {profile.handle} · {profile.subtitle}</div>
        </div>
        <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} />
        <div style={{ padding: density === 'compact' ? 14 : 20 }}>
          <PostText copy={copy} tags={tags} density={density} />
          {showCommentField && <CommentField placeholder="Join the discussion..." density={density} />}
          {showSpec && <CreativeSpec spec={spec} />}
        </div>
      </article>
    )
  }

  if (platform === 'medium') {
    return (
      <article className={className} style={shellStyle}>
        <div style={{ padding: density === 'compact' ? 14 : 20, borderBottom: `1px solid ${color.line}` }}>
          <div style={{ fontSize: t.size.micro, color: platformAccent.medium, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide, fontWeight: t.weight.semibold }}>Medium article preview</div>
          <h2 style={{ margin: '8px 0 4px', color: color.ink, fontSize: density === 'compact' ? t.size.h4 : t.size.h3, lineHeight: 1.2 }}>{post.title || subjectFromCopy(post.copy) || 'Untitled Medium draft'}</h2>
          <div style={{ color: color.ghost, fontSize: t.size.cap }}>By {profile.name} · {profile.handle} · draft</div>
        </div>
        <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} />
        <div style={{ padding: density === 'compact' ? 14 : 20 }}>
          <PostText copy={copy} tags={tags} density={density} />
          <PlatformActionRow
            actions={[
              { icon: <ThumbsUp size={16} />, label: 'Clap' },
              { icon: <MessageCircle size={16} />, label: 'Respond' },
              { icon: <Bookmark size={16} />, label: 'Save' },
            ]}
          />
          {showCommentField && <CommentField placeholder="Write a response..." density={density} />}
          {showSpec && <CreativeSpec spec={spec} />}
        </div>
      </article>
    )
  }

  return (
    <article className={className} style={shellStyle}>
      <PreviewHeader platform={platform} profile={profile} density={density} />
      <div style={{ padding: density === 'compact' ? '0 14px 12px' : '0 18px 14px' }}>
        <PostText copy={copy} tags={tags} density={density} />
      </div>
      <MediaBlock post={post} spec={spec} density={density} autoplayMedia={autoplayMedia} />
      <LinkedInActions platform={platform} />
      {showCommentField && <CommentField placeholder="Add a comment..." density={density} />}
      {showSpec && <CreativeSpec spec={spec} />}
    </article>
  )
}

function PreviewHeader({ platform, profile, density }: { platform: PlatformKind; profile: Profile; density: Density }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: density === 'compact' ? 12 : 16 }}>
      <Avatar profile={profile} size={platform === 'instagram' || platform === 'tiktok' ? 36 : 44} platform={platform} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: color.ghost, fontSize: t.size.cap, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span>{profile.handle} · {profile.subtitle}</span>
          {platform === 'linkedin' && <Globe2 size={11} />}
        </div>
      </div>
      <MoreHorizontal size={18} style={{ color: color.ghost, flexShrink: 0 }} />
    </header>
  )
}

function XHeader({ profile }: { profile: Profile }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <span style={{ color: color.ink, fontSize: t.size.body, fontWeight: t.weight.semibold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</span>
      <span style={{ color: color.ghost, fontSize: t.size.cap, whiteSpace: 'nowrap' }}>{profile.handle} · {profile.subtitle} · now</span>
      <MoreHorizontal size={16} style={{ marginLeft: 'auto', color: color.ghost, flexShrink: 0 }} />
    </div>
  )
}

function EmailHeader({ post, profile }: { post: Post; profile: Profile }) {
  const subject = subjectFromCopy(post.copy) || post.title || 'Draft email'
  return (
    <header style={{ padding: '14px 16px', borderBottom: `1px solid ${color.line}`, background: color.paper2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar profile={profile} size={36} platform="email" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: color.ink, fontSize: t.size.sm, fontWeight: t.weight.semibold }}>{subject}</div>
          <div style={{ color: color.ghost, fontSize: t.size.cap, marginTop: 2 }}>From {profile.name} · {profile.handle} · {profile.subtitle}</div>
        </div>
        <Clock3 size={16} style={{ color: color.ghost, flexShrink: 0 }} />
      </div>
    </header>
  )
}

function MediaBlock({
  post,
  spec,
  density,
  autoplayMedia,
  framed = false,
}: {
  post: Post
  spec: CreativeSpecValue
  density: Density
  autoplayMedia: boolean
  framed?: boolean
}) {
  const frames = mediaFrames(post)
  const hasMedia = frames.length > 0 || !!post.media_url
  if (!hasMedia) return null

  const shell: CSSProperties = framed
    ? { marginTop: 12, overflow: 'hidden', border: `1px solid ${color.line}`, borderRadius: radius.md, background: '#050505' }
    : { borderTop: `1px solid ${color.line}`, background: '#050505' }

  if (post.media_type === 'carousel' && frames.length > 0) {
    return (
      <div style={shell}>
        <div style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', gap: framed ? 8 : 0, padding: framed ? 8 : 0 }}>
          {frames.map((frame, index) => (
            <div
              key={`${frame.url}-${index}`}
              style={{
                flex: framed ? '0 0 88%' : '0 0 100%',
                position: 'relative',
                scrollSnapAlign: 'center',
                aspectRatio: spec.aspectRatio,
                background: '#050505',
                overflow: 'hidden',
                borderRadius: framed ? radius.sm : 0,
              }}
            >
              <img src={frame.url} alt={frame.text ?? `Frame ${index + 1}`} style={mediaStyle} />
              <FramePill current={index + 1} total={frames.length} />
            </div>
          ))}
        </div>
        <FrameDots count={frames.length} />
      </div>
    )
  }

  const src = post.media_url ?? frames[0]?.url
  if (!src) return null

  return (
    <div style={shell}>
      <div style={{ position: 'relative', aspectRatio: spec.aspectRatio, background: '#050505' }}>
        {post.media_type === 'video' ? (
          <VideoWithFallback
            src={src}
            controls={density !== 'compact'}
            autoPlay={autoplayMedia}
            loop={autoplayMedia}
            style={mediaStyle}
          />
        ) : (
          <img src={src} alt="" style={mediaStyle} />
        )}
      </div>
    </div>
  )
}

// fal.media video links are flaky (intermittent 503), so a failed load shows a
// clear placeholder with a direct link instead of a black box.
function VideoWithFallback({ src, controls, autoPlay, loop, style }: {
  src: string
  controls: boolean
  autoPlay: boolean
  loop: boolean
  style: CSSProperties
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16, textAlign: 'center' }}>
        <div style={{ fontSize: t.size.cap, color: '#e6e6e6' }}>Video preview unavailable right now.</div>
        <a href={src} target="_blank" rel="noopener noreferrer" style={{ fontSize: t.size.cap, color: '#8ab4ff', textDecoration: 'underline' }}>Open the video directly</a>
      </div>
    )
  }
  return (
    <video
      src={src}
      controls={controls}
      autoPlay={autoPlay}
      muted
      loop={loop}
      playsInline
      preload="metadata"
      style={style}
      onError={() => setFailed(true)}
    />
  )
}

function InstagramActions({ platform }: { platform: PlatformKind }) {
  return (
    <div style={{ padding: '10px 12px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: color.ink }}>
        <Heart size={21} />
        <MessageCircle size={21} />
        <Send size={21} />
        <Bookmark size={21} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ marginTop: 8, color: color.ink, fontSize: t.size.cap, fontWeight: t.weight.semibold }}>{platform === 'tiktok' ? 'Preview engagement' : 'Liked by audience preview'}</div>
    </div>
  )
}

function LinkedInActions({ platform }: { platform: PlatformKind }) {
  const actions = platform === 'facebook'
    ? [{ icon: <ThumbsUp size={16} />, label: 'Like' }, { icon: <MessageCircle size={16} />, label: 'Comment' }, { icon: <Share2 size={16} />, label: 'Share' }]
    : [{ icon: <ThumbsUp size={16} />, label: 'Like' }, { icon: <MessageCircle size={16} />, label: 'Comment' }, { icon: <Repeat2 size={16} />, label: 'Repost' }, { icon: <Send size={16} />, label: 'Send' }]
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', color: color.ghost, fontSize: t.size.cap, borderTop: `1px solid ${color.line}` }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Eye size={14} /> Preview reactions</span>
        <span>0 comments</span>
      </div>
      <div style={{ display: 'flex', borderTop: `1px solid ${color.line}` }}>
        {actions.map(action => (
          <span key={action.label} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 6px', color: color.ghost, fontSize: t.size.cap, fontWeight: t.weight.medium }}>
            {action.icon}
            {action.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function PlatformActionRow({ actions }: { actions: Array<{ icon: ReactNode; label: string }> }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 14, color: color.ghost }}>
      {actions.map(action => (
        <span key={action.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: t.size.cap, fontWeight: t.weight.medium }}>
          {action.icon}
          {action.label}
        </span>
      ))}
    </div>
  )
}

function CaptionBlock({ profileName, copy, tags, density }: { profileName: string; copy: string; tags: string[]; density: Density }) {
  return (
    <div style={{ padding: density === 'compact' ? '4px 12px 10px' : '6px 14px 12px' }}>
      <p style={{ margin: 0, color: color.ink, fontSize: t.size.sm, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
        <strong>{profileName}</strong>{' '}
        {copy}
      </p>
      {tags.length > 0 && <p style={{ margin: '7px 0 0', color: color.accentInk, fontSize: t.size.sm, lineHeight: 1.45 }}>{tags.join(' ')}</p>}
      <div style={{ marginTop: 8, color: color.ghost, fontSize: t.size.micro, textTransform: 'uppercase', letterSpacing: t.letterSpacing.wide }}>View all comments</div>
    </div>
  )
}

function PostText({ copy, tags, density }: { copy: string; tags: string[]; density: Density }) {
  return (
    <>
      <p style={{ margin: 0, color: color.ink, fontSize: density === 'compact' ? t.size.sm : t.size.body, lineHeight: 1.52, whiteSpace: 'pre-wrap' }}>{copy || 'No copy yet.'}</p>
      {tags.length > 0 && <p style={{ margin: '10px 0 0', color: color.accentInk, fontSize: density === 'compact' ? t.size.sm : t.size.body, lineHeight: 1.45 }}>{tags.join(' ')}</p>}
    </>
  )
}

function CommentField({ placeholder, density, compact = false, icon }: { placeholder: string; density: Density; compact?: boolean; icon?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: compact ? '12px 0 0' : 0, padding: compact ? 0 : density === 'compact' ? '10px 12px 12px' : '12px 14px 14px', borderTop: compact ? 'none' : `1px solid ${color.line}` }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: color.paper2, border: `1px solid ${color.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color.ghost, flexShrink: 0 }}>
        {icon ?? <Smile size={14} />}
      </div>
      <div style={{ flex: 1, minHeight: 32, display: 'flex', alignItems: 'center', padding: '0 11px', border: `1px solid ${color.line}`, borderRadius: radius.pill, color: color.ghost, fontSize: t.size.cap, background: color.paper }}>
        {placeholder}
      </div>
    </div>
  )
}

function CreativeSpec({ spec }: { spec: CreativeSpecValue }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', borderTop: `1px solid ${color.line}`, background: color.paper2, color: color.ghost, fontSize: t.size.micro }}>
      <span>{spec.label}</span>
      <span style={{ fontFamily: t.family.mono }}>{spec.dimensions}</span>
    </div>
  )
}

function Avatar({ profile, size, platform }: { profile: Profile; size: number; platform: PlatformKind }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: platformAccent[platform],
        color: platform === 'tiktok' ? '#fff' : '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(11, Math.round(size * 0.38)),
        fontWeight: t.weight.semibold,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {profile.avatarUrl ? (
        <img
          src={profile.avatarUrl}
          alt={profile.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : profile.initials}
    </div>
  )
}

function FramePill({ current, total }: { current: number; total: number }) {
  return (
    <span style={{ position: 'absolute', top: 8, right: 8, color: '#fff', background: 'rgba(0,0,0,0.68)', borderRadius: radius.pill, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {current}/{total}
    </span>
  )
}

function FrameDots({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0 10px', background: color.surface }}>
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} style={{ width: 6, height: 6, borderRadius: '50%', background: index === 0 ? color.accent : color.line2 }} />
      ))}
    </div>
  )
}

function Metric({ icon, label }: { icon: ReactNode; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{icon}<span>{label}</span></span>
}

type Profile = {
  name: string
  subtitle: string
  handle: string
  initials: string
  avatarUrl: string
}

function previewProfile(): Profile {
  const name = 'Jennifer Fleming'
  return {
    name,
    subtitle: 'Content Generator',
    handle: '@jenniferfleming',
    initials: 'JF',
    avatarUrl: '/jennifer-fleming-avatar.png',
  }
}

function normalizePlatform(channel?: string | null): PlatformKind {
  const c = (channel ?? '').toLowerCase()
  if (c.includes('instagram')) return 'instagram'
  if (c.includes('linkedin')) return 'linkedin'
  if (c === 'x' || c.includes('twitter')) return 'x'
  if (c.includes('facebook')) return 'facebook'
  if (c.includes('tiktok')) return 'tiktok'
  if (c.includes('youtube') || c.includes('short')) return 'youtube'
  if (c.includes('reddit')) return 'reddit'
  if (c.includes('quora')) return 'quora'
  if (c.includes('medium')) return 'medium'
  if (c.includes('email') || c.includes('newsletter')) return 'email'
  if (c.includes('blog') || c.includes('article') || c.includes('substack')) return 'blog'
  return 'generic'
}

type CreativeSpecValue = {
  aspectRatio: string
  dimensions: string
  label: string
}

function creativeSpec(post: Post, platform: PlatformKind): CreativeSpecValue {
  const descriptor = `${post.channel ?? ''} ${post.format ?? ''} ${post.title ?? ''} ${post.media_type ?? ''}`.toLowerCase()
  const isVertical = /reel|story|short|tiktok|vertical/.test(descriptor)
  const isCarousel = post.media_type === 'carousel' || /carousel/.test(descriptor)
  const isVideo = post.media_type === 'video'

  if (platform === 'instagram') {
    if (isVertical || isVideo) return { aspectRatio: '9 / 16', dimensions: '1080 x 1920', label: 'Instagram Reel or Story' }
    if (isCarousel) return { aspectRatio: '1 / 1', dimensions: '1080 x 1080', label: 'Instagram carousel' }
    return { aspectRatio: '4 / 5', dimensions: '1080 x 1350', label: 'Instagram feed portrait' }
  }
  if (platform === 'tiktok') return { aspectRatio: '9 / 16', dimensions: '1080 x 1920', label: 'TikTok vertical video' }
  if (platform === 'youtube') return { aspectRatio: isVertical || descriptor.includes('short') ? '9 / 16' : '16 / 9', dimensions: isVertical || descriptor.includes('short') ? '1080 x 1920' : '1920 x 1080', label: isVertical || descriptor.includes('short') ? 'YouTube Short' : 'YouTube video' }
  if (platform === 'linkedin') return { aspectRatio: isVideo ? '16 / 9' : '1.91 / 1', dimensions: isVideo ? '1920 x 1080' : '1200 x 627', label: isVideo ? 'LinkedIn video' : 'LinkedIn feed image' }
  if (platform === 'x') return { aspectRatio: '16 / 9', dimensions: '1600 x 900', label: 'X media card' }
  if (platform === 'facebook') return { aspectRatio: '4 / 5', dimensions: '1080 x 1350', label: 'Facebook feed portrait' }
  if (platform === 'reddit') return { aspectRatio: '16 / 9', dimensions: '1200 x 675', label: 'Reddit media attachment' }
  if (platform === 'quora') return { aspectRatio: '16 / 9', dimensions: '1200 x 675', label: 'Quora answer image' }
  if (platform === 'medium') return { aspectRatio: '16 / 9', dimensions: '1600 x 900', label: 'Medium hero image' }
  if (platform === 'email') return { aspectRatio: '16 / 9', dimensions: '1200 x 675', label: 'Email hero image' }
  if (platform === 'blog') return { aspectRatio: '16 / 9', dimensions: '1600 x 900', label: 'Article hero image' }
  return { aspectRatio: '16 / 9', dimensions: '1200 x 675', label: 'Generic post media' }
}

function mediaFrames(post: Post): MediaFrame[] {
  const frames = post.media_metadata?.frames
  if (!Array.isArray(frames)) return []
  return frames.filter((frame): frame is MediaFrame => (
    !!frame &&
    typeof frame === 'object' &&
    typeof (frame as { url?: unknown }).url === 'string' &&
    (frame as { url: string }).url.length > 0
  ))
}

function normalizeTags(tags?: string[]) {
  if (!Array.isArray(tags)) return []
  return tags
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
}

function copyWithoutSubject(copy: string) {
  return copy.replace(/^Subject:.+\n+/i, '').trim()
}

function subjectFromCopy(copy?: string) {
  const match = (copy ?? '').match(/^Subject:\s*(.+)$/im)
  return match?.[1]?.trim()
}

const mediaStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'cover',
  objectPosition: 'center',
}
