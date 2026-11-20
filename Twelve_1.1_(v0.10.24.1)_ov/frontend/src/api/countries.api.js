import apiClient from "./client";

export const listCountries = () => apiClient.get("/countries").then((r) => r.data.countries);
