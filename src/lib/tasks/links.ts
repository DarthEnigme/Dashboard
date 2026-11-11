/** Where a task opens: its board, with the task's dialog open. Used by the page, the widget and the reminders sent out. */
export const taskHref = (t: { id: number; board_id: number }) => `/tasks?board=${t.board_id}&task=${t.id}`;
