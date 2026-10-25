import React, { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Slider,
  Typography,
} from "@mui/material";
import Cropper from "react-easy-crop";

// Cắt ảnh theo vùng crop đã chọn, trả về 1 Blob JPEG vuông (dùng canvas)
async function getCroppedBlob(imageSrc, cropPixels) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  const size = 512; // avatar output 512x512
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    size,
    size
  );

  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

/**
 * props:
 * - open, onClose
 * - onCropped: (blob) => void
 */
export default function AvatarCropper({ open, onClose, onCropped }) {
  const fileInputRef = useRef(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_, areaPixels) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result);
    reader.readAsDataURL(file);
  };

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      if (!blob || blob.size === 0) {
        throw new Error("Không cắt được ảnh. Thử chọn ảnh khác hoặc thu phóng lại.");
      }
      await onCropped(blob);
      handleClose();
    } catch (err) {
      console.error("Avatar crop/upload error:", err);
      // onCropped (WelcomeSetupDialog) đã hiện snackbar; vẫn rethrow nếu cần
      if (err?.message && !err?.response) {
        // lỗi crop local — caller có thể không bắt, nên không đóng dialog
        alert(err.message);
        return;
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Cập nhật ảnh đại diện</DialogTitle>
      <DialogContent>
        {!imageSrc ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Chọn một ảnh — nếu ảnh không đúng tỉ lệ 1:1, bạn có thể dùng trình chỉnh sửa của Twelve để cắt đúng vị trí mong muốn.
            </Typography>
            <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
              Chọn ảnh
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleFileChange}
            />
          </Box>
        ) : (
          <>
            <Box sx={{ position: "relative", width: "100%", height: 320, bgcolor: "#000" }}>
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </Box>
            <Box sx={{ px: 1, mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Thu phóng
              </Typography>
              <Slider
                value={zoom}
                min={1}
                max={3}
                step={0.05}
                onChange={(_, v) => setZoom(v)}
              />
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={handleClose}>Hủy</Button>
        {imageSrc && (
          <Button variant="contained" onClick={handleConfirm} disabled={processing}>
            {processing ? "Đang xử lý..." : "Lưu ảnh đại diện"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
