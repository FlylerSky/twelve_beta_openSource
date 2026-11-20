import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Snackbar, Alert } from "@mui/material";

const SnackbarContext = createContext(null);

export function SnackbarProvider({ children }) {
  const [state, setState] = useState({ open: false, message: "", severity: "info" });

  const showMessage = useCallback((message, severity = "info") => {
    setState({ open: true, message, severity });
  }, []);

  const handleClose = () => setState((s) => ({ ...s, open: false }));

  const value = useMemo(
    () => ({
      success: (msg) => showMessage(msg, "success"),
      error: (msg) => showMessage(msg, "error"),
      info: (msg) => showMessage(msg, "info"),
      warning: (msg) => showMessage(msg, "warning"),
    }),
    [showMessage]
  );

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={handleClose} severity={state.severity} variant="filled" sx={{ width: "100%" }}>
          {state.message}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar() {
  return useContext(SnackbarContext);
}
