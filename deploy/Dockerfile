# Brain Town — static image. Same nginx release (1.30.7) as the author's public edge.
FROM nginx:1.30.7-alpine3.24

COPY deploy/nginx/site.conf /etc/nginx/conf.d/default.conf
COPY web/town/index.html /usr/share/nginx/html/index.html
COPY web/backoffice/ /usr/share/nginx/html/backoffice/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O- http://127.0.0.1/healthz || exit 1
