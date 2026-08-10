import { useEffect, useId, useRef, useState } from "react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function SelectMenu({
  options,
  value,
  onChange,
  label,
  disabled = false,
  className = "",
}) {
  const listboxId = useId();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : 0
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function openMenu(index = selectedIndex >= 0 ? selectedIndex : 0) {
    setActiveIndex(index);
    setOpen(true);
  }

  function selectOption(index) {
    const option = options[index];
    if (!option || option.disabled) {
      return;
    }
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openMenu(selectedIndex >= 0 ? selectedIndex : 0);
      } else {
        setActiveIndex((current) => (current + 1) % options.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu(selectedIndex >= 0 ? selectedIndex : options.length - 1);
      } else {
        setActiveIndex((current) => (current - 1 + options.length) % options.length);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) {
        selectOption(activeIndex);
      } else {
        openMenu();
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <span
      ref={rootRef}
      className={joinClassNames("lz-v2-select-menu", className)}
    >
      <button
        type="button"
        className={joinClassNames(
          "lz-v2-select-menu__trigger",
          selectedOption && "lz-v2-select-menu__trigger--selected"
        )}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="lz-v2-select-menu__value" aria-hidden="true">
          {selectedOption?.label || "\u00a0"}
        </span>
        <span className="lz-v2-select-menu__chevron" aria-hidden="true">⌄</span>
      </button>

      {open ? (
        <ul className="lz-v2-select-menu__listbox" id={listboxId} role="listbox">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listboxId}-option-${index}`}
              className={joinClassNames(
                "lz-v2-select-menu__option",
                index === activeIndex && "lz-v2-select-menu__option--active"
              )}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              onClick={() => selectOption(index)}
              onMouseMove={() => setActiveIndex(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
