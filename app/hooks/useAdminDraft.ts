import { useEffect, useRef, useState } from "react";

export function useAdminDraft<Form>(remoteForm: Form) {
  const [form, setForm] = useState(remoteForm);
  const remoteValue = JSON.stringify(remoteForm);
  const previousRemoteValue = useRef(remoteValue);

  useEffect(() => {
    if (previousRemoteValue.current === remoteValue) return;
    const previous = previousRemoteValue.current;
    previousRemoteValue.current = remoteValue;
    // Refresh clean forms, but never replace an unsaved draft.
    setForm((current) =>
      JSON.stringify(current) === previous ? remoteForm : current
    );
  }, [remoteForm, remoteValue]);

  return [form, setForm] as const;
}
