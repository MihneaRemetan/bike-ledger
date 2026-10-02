import { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  InputAdornment, MenuItem, TextField,
} from '@mui/material';
import { toLocalInput } from '../lib/format';

const blank = (f) => (f.type === 'checkbox' ? false : '');

function buildInitial(fields, initialValues) {
  const v = {};
  for (const f of fields) {
    let val = initialValues?.[f.name];
    if (val == null) val = blank(f);
    if (f.type === 'datetime' && val) val = toLocalInput(val);
    v[f.name] = val;
  }
  return v;
}

export default function EntityFormDialog({
  open, title, fields, initialValues, onSubmit, onClose, submitLabel = 'Save', onFieldChange,
}) {
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(buildInitial(fields, initialValues));
      setErrors({});
      setFormError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValues]);

  const change = (name, value) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      return onFieldChange ? { ...next, ...onFieldChange(name, value, next) } : next;
    });
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      const out = { ...values };
      for (const f of fields) {
        if (f.type === 'datetime' && out[f.name]) out[f.name] = new Date(out[f.name]).toISOString();
      }
      await onSubmit(out);
    } catch (err) {
      const fe = err.fieldErrors || {};
      const known = Object.keys(fe).filter((k) => fields.some((f) => f.name === k));
      setErrors(fe);
      if (!known.length) setFormError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          {fields.map((f) => {
            if (f.visible && !f.visible(values)) return null;
            const common = {
              key: f.name, label: f.label, required: f.required, size: 'small', fullWidth: true,
              error: Boolean(errors[f.name]), helperText: errors[f.name] || f.helperText,
              value: values[f.name] ?? '',
              onChange: (e) => change(f.name, e.target.value),
            };
            if (f.type === 'checkbox') {
              return (
                <FormControlLabel
                  key={f.name}
                  label={f.label}
                  control={<Checkbox checked={Boolean(values[f.name])} onChange={(e) => change(f.name, e.target.checked)} />}
                />
              );
            }
            if (f.type === 'select') {
              const opts = typeof f.options === 'function' ? f.options(values) : f.options;
              return (
                <TextField {...common} select>
                  {!f.required && <MenuItem value="">None</MenuItem>}
                  {opts.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
              );
            }
            const inputType = { number: 'number', date: 'date', datetime: 'datetime-local' }[f.type] || 'text';
            return (
              <TextField
                {...common}
                type={inputType}
                multiline={f.type === 'textarea'}
                minRows={f.type === 'textarea' ? 2 : undefined}
                slotProps={{
                  inputLabel: inputType === 'date' || inputType === 'datetime-local' ? { shrink: true } : undefined,
                  input: f.endAdornment ? { endAdornment: <InputAdornment position="end">{f.endAdornment}</InputAdornment> } : undefined,
                  htmlInput: f.type === 'number' ? { step: 'any', min: 0 } : undefined,
                }}
              />
            );
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
