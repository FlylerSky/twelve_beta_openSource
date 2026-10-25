import apiClient from "./client";

export const getBackendVersion = () => apiClient.get("/version").then((r) => r.data.backend);

export const getFrontendVersion = () =>
  fetch("/version.json")
    .then((r) => r.json())
    .then((d) => d.frontend);
