"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
import { LANGUAGES, messages, type Language } from "@/lib/i18n";

export function LanguageSwitcher({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId(), label = messages[language].language;
  const current = LANGUAGES.find(item => item.code === language)!;

  useEffect(() => {
    if (!open) return;
    options.current[LANGUAGES.findIndex(item => item.code === language)]?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, language]);

  function close() { setOpen(false); trigger.current?.focus(); }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    const index = options.current.findIndex(option => option === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? LANGUAGES.length - 1
      : event.key === "ArrowDown" ? (index + 1) % LANGUAGES.length
      : event.key === "ArrowUp" ? (index - 1 + LANGUAGES.length) % LANGUAGES.length : null;
    if (next !== null) { event.preventDefault(); options.current[next]?.focus(); }
    if (event.key === "Tab") setOpen(false);
  }

  return <div className="language-switcher" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className={`language-trigger ${open ? "is-open" : ""}`} aria-label={`${label}：${current.label}`} title={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}>
      <Languages size={17} aria-hidden="true" /><span className="language-current">{current.label}</span><ChevronDown className="language-chevron" size={13} aria-hidden="true" />
    </button>
    {open && <div className="language-menu" id={menuId} role="menu" aria-label={label} onKeyDown={onKeyDown}>
      <div className="language-menu-heading" aria-hidden="true">{label}</div>
      {LANGUAGES.map((item, index) => <button key={item.code} ref={element => { options.current[index] = element; }} type="button"
        role="menuitemradio" aria-checked={language === item.code} tabIndex={-1} className={`language-option ${language === item.code ? "selected" : ""}`}
        onClick={() => { onChange(item.code); close(); }}>
        <span className="language-code" aria-hidden="true">{item.short}</span><span lang={item.code}>{item.label}</span>
        {language === item.code && <Check size={15} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
