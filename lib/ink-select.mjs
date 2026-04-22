import React, { useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";

const h = React.createElement;
const CANCELLED = Symbol("ink-select-cancelled");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getViewport(total, visibleCount, focusIndex) {
  if (total <= visibleCount) {
    return { start: 0, end: total };
  }

  const start = clamp(focusIndex - Math.floor(visibleCount / 2), 0, total - visibleCount);
  return { start, end: start + visibleCount };
}

function TextLine({ text, color, dimColor, bold }) {
  return h(Text, { wrap: "truncate-end", color, dimColor, bold }, text);
}

function SelectApp({ title, subtitle, options, initialIndex = 0 }) {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [cursor, setCursor] = useState(clamp(initialIndex, 0, Math.max(0, options.length - 1)));

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c") || key.escape) {
      exit(CANCELLED);
      return;
    }

    if (key.upArrow) {
      setCursor((value) => clamp(value - 1, 0, Math.max(0, options.length - 1)));
      return;
    }

    if (key.downArrow) {
      setCursor((value) => clamp(value + 1, 0, Math.max(0, options.length - 1)));
      return;
    }

    if (!key.return) {
      return;
    }

    const option = options[cursor];
    if (!option || option.disabled) {
      return;
    }

    exit(option.value);
  });

  const reservedRows = 4 + (subtitle ? 1 : 0);
  const availableRows = Math.max(1, rows - reservedRows);
  const { start, end } = getViewport(options.length, availableRows, cursor);

  const children = [
    h(TextLine, { key: "title", text: title, bold: true }),
    h(TextLine, {
      key: "help",
      text: "Use up/down to move, Enter to select, Escape to cancel",
      dimColor: true,
    }),
  ];

  if (subtitle) {
    children.push(h(TextLine, { key: "subtitle", text: subtitle, dimColor: true }));
  }

  children.push(h(TextLine, { key: "gap", text: "" }));

  for (let index = start; index < end; index += 1) {
    const option = options[index];
    const active = cursor === index;
    const prefix = active ? ">" : " ";
    const suffix = option.hint ? `  > ${option.hint}` : "";
    children.push(h(TextLine, {
      key: `option-${option.label}-${index}`,
      text: `${prefix} ${option.label}${suffix}`,
      color: option.disabled ? undefined : active ? "cyan" : undefined,
      dimColor: option.disabled,
      bold: active && !option.disabled,
    }));
  }

  return h(Box, { flexDirection: "column" }, children);
}

export async function promptSelectInteractive({ title, subtitle = "", options, initialValue } = {}) {
  const normalizedOptions = options.map((option) => ({ disabled: false, ...option }));
  const initialIndex = Math.max(0, normalizedOptions.findIndex((option) => option.value === initialValue));
  const instance = render(h(SelectApp, {
    title,
    subtitle,
    options: normalizedOptions,
    initialIndex,
  }), {
    exitOnCtrlC: false,
    patchConsole: false,
  });

  const result = await instance.waitUntilExit();
  return result === CANCELLED ? null : result;
}
