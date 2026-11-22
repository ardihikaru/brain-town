# k6 with the xk6-sse extension, built locally (no k6 cloud build service, no host install).
# Built and tagged by perf/run.sh as brain-town-e2e-k6:2.3.0-sse0.2.0. Versions are pinned.
FROM grafana/xk6:1.4.15 AS build
WORKDIR /build
RUN xk6 build v2.3.0 --with github.com/phymbert/xk6-sse@v0.2.0 --output /build/k6

FROM grafana/k6:2.3.0
COPY --from=build /build/k6 /usr/bin/k6
