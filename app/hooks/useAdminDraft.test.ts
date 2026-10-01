import { beforeEach, expect, test, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import { useAdminDraft } from "./useAdminDraft";

const mocks = vi.hoisted(() => ({
  form: undefined as unknown,
  initialized: false,
  remote: null as { current: string } | null,
  effects: [] as Array<() => void>,
}));
vi.mock("react", () => ({
  useState: <Form>(initial: Form): [Form, Dispatch<SetStateAction<Form>>] => {
    if (!mocks.initialized) {
      mocks.form = initial;
      mocks.initialized = true;
    }
    const current = mocks.form as Form;
    return [current, (next) => {
      mocks.form = typeof next === "function"
        ? (next as (form: Form) => Form)(mocks.form as Form)
        : next;
    }];
  },
  useRef: (initial: string) => mocks.remote ??= { current: initial },
  useEffect: (effect: () => void) => mocks.effects.push(effect),
}));

beforeEach(() => {
  mocks.form = undefined;
  mocks.initialized = false;
  mocks.remote = null;
  mocks.effects = [];
});

function render<Form>(remote: Form) {
  const result = useAdminDraft(remote);
  mocks.effects.splice(0).forEach((effect) => effect());
  return result;
}

test("refresh updates clean forms and does not reset unsaved edits", () => {
  render({ name: "Old", requires: ["first"] });
  render({ name: "Updated", requires: ["first", "second"] });
  expect(mocks.form).toEqual({ name: "Updated", requires: ["first", "second"] });
  const [, edit] = render({ name: "Updated", requires: ["first", "second"] });
  edit((form) => ({ ...form, name: "Unsaved draft" }));
  render({ name: "Remote change", requires: ["first"] });
  expect(mocks.form).toEqual({ name: "Unsaved draft", requires: ["first", "second"] });
  render({ name: "Another remote change", requires: [] });
  expect(mocks.form).toEqual({ name: "Unsaved draft", requires: ["first", "second"] });
});

test("a saved draft becomes clean and accepts later refreshes", () => {
  const [, edit] = render({ name: "Original" });
  edit({ name: "Saved" });
  render({ name: "Saved" });
  render({ name: "Later remote change" });
  expect(mocks.form).toEqual({ name: "Later remote change" });
});

test("equal dropdown/filter arrays do not reset drafts during parent rerenders", () => {
  const [, edit] = render({ ingredientIds: ["wood"], quantity: "1" });
  edit({ ingredientIds: ["wood"], quantity: "5" });
  for (let index = 0; index < 3; index++) {
    render({ ingredientIds: ["wood"], quantity: "1" });
  }
  expect(mocks.form).toEqual({ ingredientIds: ["wood"], quantity: "5" });
});

test("balance text drafts are retained independently of refreshed descriptions", () => {
  const [, edit] = render("1");
  edit("0.5");
  render("2");
  expect(mocks.form).toBe("0.5");
});
