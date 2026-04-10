"use client";

import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// ── Patterns ──

const PATTERNS = {
  // Math: $...$ (inline) or $$...$$ (block) — non-greedy
  mathBlock: /\$\$([\s\S]+?)\$\$/g,
  mathInline: /\$([^\$\n]+?)\$/g,
  // Color: #RGB, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla(), oklch(), oklab()
  color: /#(?:[0-9a-fA-F]{3,4}){1,2}\b|(?:rgba?|hsla?|oklch|oklab)\([^)]{5,50}\)/g,
  // Bare URLs (not inside markdown links or already linked)
  url: /(?<!\(|\]\()https?:\/\/[^\s<>\)]+/g,
  // Key combos: Ctrl+C, Cmd+Shift+P, Alt+F4 etc.
  keybinding: /\b((?:(?:Ctrl|Cmd|Alt|Shift|Option|Meta|Super|Win)\+)+(?:[A-Z0-9]|F[1-9][0-9]?|Enter|Escape|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight))\b/g,
  // File paths: /usr/local/bin, ./src/index.ts, ~/config, C:\Users\...
  filepath: /(?<!\w)(?:~\/|\.\/|\.\.\/|\/(?=[a-zA-Z]))[\w\-./]+\.\w+|(?<!\w)(?:~\/|\.\/|\.\.\/|\/(?=[a-zA-Z]))[\w\-./]{3,}|(?<!\w)[A-Z]:\\[\w\-\\.]+/g,
  // Emoji shortcodes: :rocket:, :thumbsup:, :heart:
  emoji: /:([a-z0-9_+-]+):/g,
};

// ── Emoji Map (common shortcodes) ──

const EMOJI_MAP: Record<string, string> = {
  "smile": "😄", "laughing": "😆", "blush": "😊", "smiley": "😃",
  "relaxed": "☺️", "heart_eyes": "😍", "kissing_heart": "😘",
  "wink": "😉", "stuck_out_tongue": "😛", "sunglasses": "😎",
  "sweat_smile": "😅", "joy": "😂", "rofl": "🤣",
  "thinking": "🤔", "raised_eyebrow": "🤨", "neutral_face": "😐",
  "expressionless": "😑", "unamused": "😒", "rolling_eyes": "🙄",
  "grimacing": "😬", "lying_face": "🤥", "relieved": "😌",
  "pensive": "😔", "sleepy": "😪", "sleeping": "😴",
  "mask": "😷", "nerd": "🤓", "cowboy": "🤠",
  "thumbsup": "👍", "thumbsdown": "👎", "ok_hand": "👌",
  "wave": "👋", "clap": "👏", "pray": "🙏", "handshake": "🤝",
  "muscle": "💪", "point_up": "☝️", "point_down": "👇",
  "point_left": "👈", "point_right": "👉", "middle_finger": "🖕",
  "raised_hand": "✋", "v": "✌️", "metal": "🤘",
  "heart": "❤️", "orange_heart": "🧡", "yellow_heart": "💛",
  "green_heart": "💚", "blue_heart": "💙", "purple_heart": "💜",
  "black_heart": "🖤", "white_heart": "🤍", "broken_heart": "💔",
  "fire": "🔥", "star": "⭐", "sparkles": "✨", "zap": "⚡",
  "sun": "☀️", "moon": "🌙", "cloud": "☁️", "rain": "🌧️",
  "snow": "❄️", "rainbow": "🌈", "umbrella": "☂️",
  "rocket": "🚀", "airplane": "✈️", "car": "🚗", "bike": "🚲",
  "check": "✅", "x": "❌", "warning": "⚠️", "question": "❓",
  "exclamation": "❗", "info": "ℹ️", "bulb": "💡",
  "100": "💯", "boom": "💥", "tada": "🎉", "gift": "🎁",
  "trophy": "🏆", "medal": "🏅", "crown": "👑",
  "gem": "💎", "money": "💰", "dollar": "💵",
  "bell": "🔔", "key": "🔑", "lock": "🔒", "unlock": "🔓",
  "link": "🔗", "hammer": "🔨", "wrench": "🔧", "gear": "⚙️",
  "bug": "🐛", "ant": "🐜", "bee": "🐝", "snake": "🐍",
  "dog": "🐕", "cat": "🐈", "rabbit": "🐇", "bear": "🐻",
  "penguin": "🐧", "chicken": "🐔", "whale": "🐋",
  "apple": "🍎", "banana": "🍌", "pizza": "🍕", "coffee": "☕",
  "beer": "🍺", "wine": "🍷", "cake": "🎂",
  "eyes": "👀", "brain": "🧠", "skull": "💀",
  "robot": "🤖", "alien": "👽", "ghost": "👻",
  "poop": "💩", "earth": "🌍", "globe": "🌐",
  "book": "📖", "pencil": "✏️", "memo": "📝",
  "folder": "📁", "file": "📄", "clipboard": "📋",
  "chart": "📊", "calendar": "📅", "phone": "📱",
  "computer": "💻", "keyboard": "⌨️", "mouse": "🖱️",
  "hourglass": "⏳", "stopwatch": "⏱️", "clock": "🕐",
  "recycle": "♻️", "white_check_mark": "✅", "negative_squared_cross_mark": "❎",
  "+1": "👍", "-1": "👎",
};

// ── Renderers ──

function ColorSwatch({ color }: { color: string }) {
  // CSS natively supports all these formats in backgroundColor
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[0.8125rem]">
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border/50 shadow-sm"
        style={{ backgroundColor: color }}
      />
      <span className="max-w-[200px] truncate">{color}</span>
    </span>
  );
}

function KeyCombo({ combo }: { combo: string }) {
  const keys = combo.split("+");
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground/40 text-xs">+</span>}
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/60 bg-muted/50 px-1.5 text-[11px] font-medium text-muted-foreground shadow-[0_1px_0_0] shadow-border/40">
            {key}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

function FilePath({ path }: { path: string }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.8125rem] font-medium text-foreground">
      {path}
    </code>
  );
}

function MathInline({ tex }: { tex: string }) {
  try {
    const html = katex.renderToString(tex, { throwOnError: false, displayMode: false });
    return <span className="inline" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <code>${tex}$</code>;
  }
}

function MathBlock({ tex }: { tex: string }) {
  try {
    const html = katex.renderToString(tex, { throwOnError: false, displayMode: true });
    return <div className="my-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <pre className="my-3">${tex}$$</pre>;
  }
}

function AutoLink({ url }: { url: string }) {
  // Clean trailing punctuation
  const clean = url.replace(/[.,;:!?)]+$/, "");
  return (
    <a
      href={clean}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60"
    >
      {clean}
    </a>
  );
}

// ── Pipeline ──

type Processor = {
  pattern: RegExp;
  render: (match: RegExpExecArray, key: number) => React.ReactNode | null;
};

const PROCESSORS: Processor[] = [
  // Math block first ($$...$$) before inline ($...$)
  {
    pattern: PATTERNS.mathBlock,
    render: (m, k) => <MathBlock key={k} tex={m[1].trim()} />,
  },
  {
    pattern: PATTERNS.mathInline,
    render: (m, k) => <MathInline key={k} tex={m[1]} />,
  },
  {
    pattern: PATTERNS.color,
    render: (m, k) => <ColorSwatch key={k} color={m[0]} />,
  },
  {
    pattern: PATTERNS.url,
    render: (m, k) => <AutoLink key={k} url={m[0]} />,
  },
  {
    pattern: PATTERNS.keybinding,
    render: (m, k) => <KeyCombo key={k} combo={m[1]} />,
  },
  {
    pattern: PATTERNS.filepath,
    render: (m, k) => <FilePath key={k} path={m[0]} />,
  },
  {
    pattern: PATTERNS.emoji,
    render: (m, k) => {
      const emoji = EMOJI_MAP[m[1]];
      return emoji ? <span key={k} title={`:${m[1]}:`}>{emoji}</span> : null;
    },
  },
];

/**
 * Process a string through all rich text processors.
 * Returns an array of React nodes with plain text and enriched elements.
 */
export function enrichText(text: string): React.ReactNode[] {
  // Build a combined regex from all patterns
  const allMatches: { index: number; end: number; node: React.ReactNode }[] = [];
  let keyCounter = 0;

  for (const proc of PROCESSORS) {
    const re = new RegExp(proc.pattern.source, proc.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const node = proc.render(match, keyCounter++);
      if (node !== null) {
        allMatches.push({ index: match.index, end: match.index + match[0].length, node });
      }
    }
  }

  if (allMatches.length === 0) return [text];

  // Sort by index, remove overlaps (first match wins)
  allMatches.sort((a, b) => a.index - b.index);
  const filtered: typeof allMatches = [];
  let lastEnd = 0;
  for (const m of allMatches) {
    if (m.index >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // Build result
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of filtered) {
    if (m.index > pos) {
      parts.push(text.slice(pos, m.index));
    }
    parts.push(m.node);
    pos = m.end;
  }
  if (pos < text.length) {
    parts.push(text.slice(pos));
  }

  return parts;
}

/**
 * Process React children recursively, enriching string nodes.
 */
export function processChildren(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const result = enrichText(child);
      return result.length === 1 && typeof result[0] === "string" ? child : result;
    }
    return child;
  });
}
