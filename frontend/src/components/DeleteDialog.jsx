import { api } from '../api/client';
import ConfirmDialog from './ConfirmDialog';
import { useNotify } from './Notify';

// Confirms and runs DELETE `${path}/${item.id}`. `item` is the row to delete (null keeps the dialog closed);
// `text` is a string or a function of the item.
export default function DeleteDialog({ item, path, title, text, deletedMessage, onClose, onDeleted }) {
  const notify = useNotify();
  return (
    <ConfirmDialog
      open={Boolean(item)}
      title={title}
      text={typeof text === 'function' ? (item ? text(item) : '') : text}
      onClose={onClose}
      onConfirm={async () => {
        try {
          await api(`${path}/${item.id}`, { method: 'DELETE' });
          notify.success(deletedMessage);
          onClose();
          onDeleted();
        } catch (e) {
          notify.error(e.message);
        }
      }}
    />
  );
}
