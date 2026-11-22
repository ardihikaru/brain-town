# Brain Town API: static Go binary on scratch. Build context is ./backend.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/braintown ./cmd/braintown

FROM scratch
COPY --from=build /out/braintown /braintown
USER 65534:65534
EXPOSE 8081
ENTRYPOINT ["/braintown"]
