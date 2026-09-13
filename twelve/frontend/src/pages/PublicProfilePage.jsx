import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Container, Box, Avatar, Typography, Chip, CircularProgress, Stack } from "@mui/material";
import Navbar from "../components/Navbar";
import { getPublicProfile } from "../api/users.api";
import { useSnackbar } from "../context/SnackbarContext";

export default function PublicProfilePage() {
  const { uid } = useParams();
  const snackbar = useSnackbar();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPublicProfile(uid)
      .then(setUser)
      .catch((err) => snackbar.error(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  return (
    <>
      <Navbar />
      <Container maxWidth="sm" sx={{ py: 6 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : !user ? (
          <Typography textAlign="center" color="text.secondary">
            Không tìm thấy người dùng.
          </Typography>
        ) : (
          <Stack alignItems="center" spacing={1}>
            <Avatar src={user.avatarUrl} sx={{ width: 96, height: 96 }}>
              {user.displayName?.[0]}
            </Avatar>
            <Typography variant="h5" fontWeight={700}>
              {user.displayName}
            </Typography>
            <Chip label={user.tagName} variant="outlined" />
            {user.country && (
              <Typography variant="body2" color="text.secondary">
                {user.country}
              </Typography>
            )}
          </Stack>
        )}
      </Container>
    </>
  );
}
