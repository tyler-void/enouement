const notes: { id: number; text: string }[] = [];

export function listNotes() {
  return notes;
}

export function addNote(text: string) {
  const note = { id: notes.length + 1, text };
  notes.push(note);
  return note;
}
