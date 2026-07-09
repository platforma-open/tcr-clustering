# GLIPH2 runner image: R 4.4.2 + turboGliph (and its archived-on-CRAN dependency `grr`, built
# from source on Linux), with run_gliph2.R baked at /app. Built + published by CI to the block
# docker registry. Consumed as a docker-only software by the clustering step (the GLIPH2 half of
# the GLIPH2 + Leiden engine) — there is no local/binary fallback, so it requires docker at runtime
# (k8s, or build:dev-remote locally).
FROM r-base:4.4.2

ENV R_VERSION=4.4.2
ENV BIOCONDUCTOR_VERSION=3.20
ENV RENV_VERSION=1.0.11
ENV RENV_CONFIG_PPM_ENABLED=false
ENV RENV_CONFIG_REPOS_OVERRIDE=https://cloud.r-project.org

# System deps for building the R package tree from source. Superset from tcr-disco's proven R image
# plus libglpk-dev / libgmp-dev for igraph. The load-bearing ones here are the curl/ssl/xml trio and
# a C/C++ toolchain (grr builds from source); trim only after a green build.
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    dash \
    default-libmysqlclient-dev \
    libbz2-dev \
    libcairo2-dev \
    libcurl4-openssl-dev \
    libfreetype6-dev \
    libfribidi-dev \
    libgit2-dev \
    libglpk-dev \
    libgmp-dev \
    libgsl-dev \
    libharfbuzz-dev \
    libjpeg-dev \
    liblzma-dev \
    libpcre2-dev \
    libpng-dev \
    libpq-dev \
    libsasl2-dev \
    libsqlite3-dev \
    libssh2-1-dev \
    libssl-dev \
    libtiff5-dev \
    libuv1-dev \
    libxml2-dev \
    unixodbc-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN R -e "install.packages('renv', repos = 'https://cloud.r-project.org')"

# Have to use absolute paths because during execution the working directory will be changed.
ENV RENV_PATHS_RENV=/app/renv
ENV RENV_PATHS_LOCKFILE=/app/renv.lock
# Install into a project-local library and expose it via R_LIBS_USER so Rscript finds the packages
# at runtime without any renv code.
ENV R_LIBS_USER=/app/renv/library
ENV RENV_PATHS_LIBRARY=${R_LIBS_USER}
# Yes, we have to create it manually. Otherwise a default will be used silently.
RUN mkdir -p "${R_LIBS_USER}"

# COPY paths are relative to the build context (./context), where renv.lock and run_gliph2.R live.
COPY renv.lock /app/renv.lock

# First pass: parallel install (fast for the bulk of packages).
# Second pass: sequential retry to resolve any parallel-install races.
RUN R --no-echo -e "tryCatch(renv::restore(), error = function(e) message('parallel pass finished with errors: ', conditionMessage(e))); options(Ncpus = 1); renv::restore(clean = TRUE)" \
    && find /root/.cache/R -name keys.html -delete \
    && find /usr/local/lib/R -name keys.html -delete \
    && find "${R_LIBS_USER}" -name keys.html -delete

# Bake the runner script + the patched gliph2 it loads (turboGliph 0.99.2 gliph2() with the
# empty-reference crash fix; see run_gliph2.R for why). Clear the base image's entrypoint; the
# workflow supplies the full command (`Rscript /app/run_gliph2.R <input.csv> <out_dir> <n_cores>`).
COPY gliph2_patched.R /app/gliph2_patched.R
COPY run_gliph2.R /app/run_gliph2.R
ENTRYPOINT []
CMD ["Rscript", "/app/run_gliph2.R"]
