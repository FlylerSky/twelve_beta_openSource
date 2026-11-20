import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";

/**
 * Popup xác nhận dùng chung, thay cho window.confirm() của trình duyệt để
 * đồng bộ với thiết kế Material Design của Twelve.
 * props: open, title, message, onConfirm, onCancel, confirmText, confirmColor
 */
export default function ConfirmDialog({
  open,
  title = "Xác nhận",
  message,
  onConfirm,
  onCancel,
  confirmText = "Xóa",
  confirmColor = "error",
}) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onCancel}>Hủy</Button>
        <Button variant="contained" color={confirmColor} onClick={onConfirm}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
