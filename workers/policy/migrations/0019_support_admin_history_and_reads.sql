ALTER TABLE support_messages ADD COLUMN admin_read_at TEXT;

UPDATE support_messages AS m
SET admin_read_at = (
  SELECT t.admin_last_read_at FROM support_threads t WHERE t.id = m.thread_id
)
WHERE (m.sender_role IN ('customer', 'email_inbound') OR (m.sender_role IS NULL AND m.sender = 'user'))
  AND datetime(m.created_at) <= (
    SELECT datetime(t.admin_last_read_at) FROM support_threads t WHERE t.id = m.thread_id
  );

CREATE INDEX idx_support_messages_admin_unread
  ON support_messages(thread_id)
  WHERE admin_read_at IS NULL AND (sender_role IN ('customer', 'email_inbound') OR (sender_role IS NULL AND sender = 'user'));

CREATE INDEX idx_support_audit_thread_timeline
  ON support_audit_events(thread_id, COALESCE(julianday(created_at), 0) DESC, id DESC);
