import os
import re
import requests
import numpy as np
import time
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langchain_huggingface import HuggingFaceEmbeddings
from sklearn.metrics.pairwise import cosine_similarity

load_dotenv()
ED_API_KEY = os.getenv("ED_API_KEY")

# Initalize embedding model
embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-mpnet-base-v2"
)

THREAD_CACHE = {}
CACHE_TTL = 600

app = FastAPI()

# For nowe we will allow extensions to call all of this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def clean_xml_tags(text: str) -> str:
    """
    Docstring for clean_xml_tags

    :param text: Description
    :type text: str
    :return: Description
    :rtype: str
    """
    clean = re.compile('<.*?>')
    return re.sub(clean, '', text or "")


def fetch_threads_with_embeddings(course_id: int, limit: int = 1000, sort: str = "new"):
    """
    Fetch up to `limit` threads for a course (paginated) and compute content embeddings.
    Results are cached for CACHE_TTL seconds per course to avoid repeated embedding work.
    """
    now = time.time()
    cached = THREAD_CACHE.get(course_id)
    if cached and now - cached["ts"] < CACHE_TTL:
        return cached["threads"]

    host = "https://us.edstem.org"
    threads = []
    per_page = 50
    offset = 0
    last_exc = None

    try:
        while len(threads) < limit:
            url = f"{host}/api/courses/{course_id}/threads"
            params = {"limit": per_page, "offset": offset, "sort": sort}
            res = requests.get(
                url=url,
                headers={"Authorization": f"Bearer {ED_API_KEY}"},
                params=params,
                timeout=10,
            )

            if res.status_code != 200:
                last_exc = requests.HTTPError(
                    f"{res.status_code} {res.reason}: {res.text}"
                )
                break
            data = res.json()
            page = data.get("threads", [])
            if not page:
                break
            threads.extend(page)
            if len(page) < per_page:
                break
            offset += len(page)

    except requests.RequestException as e:
        last_exc = e

    if not threads:
        detail = f"Failed to fetch threads for course {course_id}: {last_exc}"
        raise HTTPException(status_code=502, detail=detail)

    threads = threads[:limit]

    # Build result list and compute embeddings (title+content or content only)
    out = []
    for t in threads:
        content = clean_xml_tags(t.get("content", "")).strip()
        # choose what to embed — title+content often better
        text_to_embed = (t.get("title", "") + " " + content).strip()
        emb = embeddings.embed_query(text_to_embed)
        out.append(
            {
                "id": t.get("id"),
                "number": t.get("number"),
                "title": t.get("title"),
                "content": content,
                "content_embedding": emb,
            }
        )

    THREAD_CACHE[course_id] = {"ts": now, "threads": out}
    return out


@app.get("/search")
def search_endpoint(
    q: str = Query(..., description="User query"),
    k: int = 5,
    course_id: int = 74827,
):
    """
    Returns top-k threads for the provided course_id ranked by cosine similarity
    to the query embedding.
    """
    # Fetch cached threads + embeddings (this fetches many threads and caches embeddings)
    threads_with_emb = fetch_threads_with_embeddings(
        course_id=course_id, limit=500)
    q_emb = embeddings.embed_query(q)
    results = []

    for t in threads_with_emb:
        content = t.get("content", "")
        content_emb = t.get("content_embedding")
        sim = float(cosine_similarity([q_emb], [content_emb])[0][0])
        results.append(
            {
                "id": t.get("id"),
                "number": t.get("number"),
                "title": t.get("title"),
                "content": content,
                "similarity": sim,
            }
        )

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return {"query": q, "results": results[:k]}
