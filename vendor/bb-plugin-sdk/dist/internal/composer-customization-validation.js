// src/internal/composer-customization-validation.ts
var PLUGIN_SLOT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
var PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
function normalizePluginThreadRowStatus(value, onRejected) {
  const kind = "contentScript.experimental_setThreadRowStatus";
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    onRejected(`${kind}: status must be null or a non-array object`);
    return void 0;
  }
  const status = value;
  const icon = status.icon;
  if (typeof icon !== "string" || icon.trim() === "") {
    onRejected(`${kind}: "icon" must be a non-blank string`);
    return void 0;
  }
  const label = status.label;
  if (typeof label !== "string" || label.trim() === "") {
    onRejected(`${kind}: "label" must be a non-blank string`);
    return void 0;
  }
  const tone = status.tone;
  if (tone !== void 0 && tone !== "default" && tone !== "running" && tone !== "success" && tone !== "error") {
    onRejected(
      `${kind}: "tone" must be "default", "running", "success", or "error" when set`
    );
    return void 0;
  }
  return {
    icon: icon.trim(),
    label: label.trim(),
    ...tone !== void 0 ? { tone } : {}
  };
}
function requireSlotId(kind, value) {
  if (typeof value !== "string" || !PLUGIN_SLOT_ID_PATTERN.test(value)) {
    throw new Error(
      `${kind}: "id" must match ${String(PLUGIN_SLOT_ID_PATTERN)}, got ${JSON.stringify(value)}`
    );
  }
  return value;
}
function requireMessageDirectiveId(kind, value) {
  if (typeof value !== "string" || !PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN.test(value)) {
    throw new Error(
      `${kind}: "id" must match ${String(PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN)}, got ${JSON.stringify(value)}`
    );
  }
  return value;
}
function requireNonEmptyString(kind, field, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${kind}: "${field}" must be a non-empty string`);
  }
  return value;
}
function requireOptionalString(kind, field, value) {
  if (value !== void 0 && typeof value !== "string") {
    throw new Error(`${kind}: "${field}" must be a string when set`);
  }
  return value;
}
function requireComponent(kind, value) {
  if (typeof value !== "function") {
    throw new Error(`${kind}: "component" must be a React component function`);
  }
  return value;
}
function requireFunction(kind, field, value) {
  if (typeof value !== "function") {
    throw new Error(`${kind}: "${field}" must be a function`);
  }
  return value;
}
function requireUniqueId(kind, seen, id) {
  if (seen.has(id)) {
    throw new Error(`${kind}: duplicate id "${id}"`);
  }
  seen.add(id);
}
function parseContributionArray(kind, value, onRejected, parse) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) {
    onRejected(`${kind}: must be an array when set`);
    return void 0;
  }
  const seenIds = /* @__PURE__ */ new Set();
  const parsed = [];
  for (const [index, entry] of value.entries()) {
    const entryKind = `${kind}[${index}]`;
    try {
      const parsedEntry = parse(entryKind, entry);
      requireUniqueId(entryKind, seenIds, parsedEntry.id);
      parsed.push(parsedEntry);
    } catch (error) {
      onRejected(error instanceof Error ? error.message : String(error));
    }
  }
  return parsed;
}
function parseRegions(kind, registration, onRejected) {
  const actions = parseContributionArray(`${kind}.actions`, registration.actions, onRejected, (entryKind, value) => {
    const entry = value;
    return {
      id: requireSlotId(entryKind, entry?.id),
      component: requireComponent(entryKind, entry?.component)
    };
  });
  const banners = parseContributionArray(`${kind}.banners`, registration.banners, onRejected, (entryKind, value) => {
    const entry = value;
    const id = requireSlotId(entryKind, entry?.id);
    const chrome = entry?.chrome;
    if (chrome !== void 0 && chrome !== "card" && chrome !== "bare") {
      throw new Error(
        `${entryKind}: "chrome" must be "card" or "bare" when set`
      );
    }
    return {
      id,
      ...chrome !== void 0 ? { chrome } : {},
      component: requireComponent(entryKind, entry?.component)
    };
  });
  const plusMenu = parseContributionArray(
    `${kind}.plusMenu`,
    registration.plusMenu,
    onRejected,
    (entryKind, value) => {
      const entry = value;
      const id = requireSlotId(entryKind, entry?.id);
      const icon = requireOptionalString(entryKind, "icon", entry?.icon);
      const description = requireOptionalString(
        entryKind,
        "description",
        entry?.description
      );
      const disabled = entry?.disabled;
      if (disabled !== void 0 && typeof disabled !== "boolean" && typeof disabled !== "function") {
        throw new Error(
          `${entryKind}: "disabled" must be a boolean or function when set`
        );
      }
      return {
        id,
        label: requireNonEmptyString(entryKind, "label", entry?.label),
        ...icon !== void 0 ? { icon } : {},
        ...description !== void 0 ? { description } : {},
        ...disabled !== void 0 ? {
          disabled
        } : {},
        run: requireFunction(entryKind, "run", entry?.run)
      };
    }
  );
  let richText;
  if (registration.richText !== void 0) {
    const raw = registration.richText;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      onRejected(`${kind}.richText: must be an object when set`);
    } else {
      const effects = parseContributionArray(
        `${kind}.richText.effects`,
        raw.effects,
        onRejected,
        (entryKind, value) => {
          const entry = value;
          return {
            id: requireSlotId(entryKind, entry?.id),
            match: requireFunction(entryKind, "match", entry?.match),
            className: requireNonEmptyString(
              entryKind,
              "className",
              entry?.className
            )
          };
        }
      );
      const onDraftChange = raw.onDraftChange;
      if (onDraftChange !== void 0 && typeof onDraftChange !== "function") {
        onRejected(
          `${kind}.richText: "onDraftChange" must be a function when set`
        );
      }
      richText = {
        ...effects !== void 0 ? { effects } : {},
        ...typeof onDraftChange === "function" ? {
          onDraftChange
        } : {}
      };
    }
  }
  return {
    ...actions !== void 0 ? { actions } : {},
    ...banners !== void 0 ? { banners } : {},
    ...plusMenu !== void 0 ? { plusMenu } : {},
    ...richText !== void 0 ? { richText } : {}
  };
}
function collectComposerCustomization(registration, seenIds, onRejected) {
  const kind = "composer.customize";
  try {
    const raw = registration;
    const id = requireSlotId(kind, raw?.id);
    const scopes = raw?.scopes;
    if (scopes !== void 0) {
      if (!Array.isArray(scopes)) {
        throw new Error(`${kind}: "scopes" must be an array when set`);
      }
      for (const scope of scopes) {
        if (scope !== "thread" && scope !== "queued-message" && scope !== "side-chat" && scope !== "new-thread") {
          throw new Error(
            `${kind}: invalid scope kind ${JSON.stringify(scope)}`
          );
        }
      }
    }
    requireUniqueId(kind, seenIds, id);
    return {
      id,
      ...scopes !== void 0 ? { scopes: [...scopes] } : {},
      ...parseRegions(`${kind}(${id})`, raw ?? {}, onRejected)
    };
  } catch (error) {
    onRejected(error instanceof Error ? error.message : String(error));
    return null;
  }
}
export {
  PLUGIN_SLOT_ID_PATTERN,
  collectComposerCustomization,
  normalizePluginThreadRowStatus,
  requireComponent,
  requireMessageDirectiveId,
  requireNonEmptyString,
  requireOptionalString,
  requireSlotId,
  requireUniqueId
};
