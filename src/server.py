import os
import re
import requests
import time
from functools import lru_cache
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pinecone import Pinecone
from cachetools import TTLCache

load_dotenv()

# Environment variables
ED_API_KEY = os.getenv("ED_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "edstem-smart-search")

# Initialize Pinecone
if not PINECONE_API_KEY:
    raise ValueError("PINECONE_API_KEY environment variable not set")

pc = Pinecone(api_key=PINECONE_API_KEY)

# Check if index exists, if not provide instructions
if not pc.has_index(PINECONE_INDEX_NAME):
    print(f"WARNING: Index '{PINECONE_INDEX_NAME}' does not exist.")
    print("Create it with: pc index create -n edstem-smart-search -m cosine -c aws -r us-east-1 --model llama-text-embed-v2 --field_map text=content")
    index = None
else:
    index = pc.Index(PINECONE_INDEX_NAME)

# Query embedding cache (TTL: 10 minutes, max 1000 entries)
query_cache = TTLCache(maxsize=1000, ttl=600)

# Sync status tracking
sync_status = {}

app = FastAPI(title="EdStem Smart Search API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SyncRequest(BaseModel):
    course_id: int
    user_token: str


class SyncStatus(BaseModel):
    course_id: int
    status: str
    progress: Optional[int] = None
    total: Optional[int] = None
    message: Optional[str] = None


def clean_xml_tags(text: str) -> str:
    """Remove XML/HTML tags from text."""
    clean = re.compile('<.*?>')
    return re.sub(clean, '', text or "")


def get_namespace(course_id: int) -> str:
    """Generate namespace for a course."""
    return f"course_{course_id}"


def fetch_all_threads(course_id: int, user_token: str, limit: int = 1000):
    """
    Fetch all threads for a course using the user's auth token.
    This respects the user's access permissions.
    """
    host = "https://us.edstem.org"
    threads = []
    per_page = 50
    offset = 0

    while len(threads) < limit:
        url = f"{host}/api/courses/{course_id}/threads"
        params = {"limit": per_page, "offset": offset, "sort": "new"}

        res = requests.get(
            url=url,
            headers={"Authorization": f"Bearer {user_token}"},
            params=params,
            timeout=15,
        )

        if res.status_code != 200:
            raise HTTPException(
                status_code=res.status_code,
                detail=f"Failed to fetch threads: {res.text}"
            )

        data = res.json()
        page = data.get("threads", [])

        if not page:
            break

        threads.extend(page)

        if len(page) < per_page:
            break

        offset += len(page)

    return threads[:limit]


def prepare_records_for_pinecone(threads: list) -> list:
    """
    Prepare thread data as records for Pinecone upsert.
    Uses the integrated embedding model, so we just pass content.
    """
    records = []

    for t in threads:
        thread_id = t.get("id")
        title = t.get("title", "")
        content = clean_xml_tags(t.get("content", "")).strip()
        category = t.get("category", "general")
        number = t.get("number", 0)

        # Combine title and content for better semantic matching
        full_content = f"{title}. {content}".strip()

        # Skip empty content
        if not full_content or len(full_content) < 10:
            continue

        # Truncate if too long (embedding model has token limits)
        if len(full_content) > 8000:
            full_content = full_content[:8000]

        records.append({
            "_id": f"thread_{thread_id}",
            "content": full_content,
            "thread_id": thread_id,
            "thread_number": number,
            "title": title,
            "category": category,
        })

    return records


async def sync_course_task(course_id: int, user_token: str):
    """Background task to sync a course to Pinecone."""
    namespace = get_namespace(course_id)

    try:
        sync_status[course_id] = {
            "status": "fetching",
            "message": "Fetching threads from EdStem..."
        }

        # Fetch all threads
        threads = fetch_all_threads(course_id, user_token)

        if not threads:
            sync_status[course_id] = {
                "status": "completed",
                "message": "No threads found in course"
            }
            return

        sync_status[course_id] = {
            "status": "processing",
            "message": f"Processing {len(threads)} threads...",
            "total": len(threads)
        }

        # Prepare records
        records = prepare_records_for_pinecone(threads)

        sync_status[course_id] = {
            "status": "indexing",
            "message": f"Indexing {len(records)} records to Pinecone...",
            "total": len(records)
        }

        # Batch upsert (96 records max per batch for text records)
        batch_size = 96
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            index.upsert_records(namespace, batch)

            sync_status[course_id] = {
                "status": "indexing",
                "progress": min(i + batch_size, len(records)),
                "total": len(records),
                "message": f"Indexed {min(i + batch_size, len(records))}/{len(records)} records"
            }

            # Small delay to avoid rate limiting
            time.sleep(0.1)

        # Wait for indexing to complete
        time.sleep(5)

        sync_status[course_id] = {
            "status": "completed",
            "message": f"Successfully indexed {len(records)} threads",
            "total": len(records)
        }

    except Exception as e:
        sync_status[course_id] = {
            "status": "error",
            "message": str(e)
        }


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "pinecone_connected": index is not None,
        "index_name": PINECONE_INDEX_NAME
    }


@app.post("/sync_course")
async def sync_course(request: SyncRequest, background_tasks: BackgroundTasks):
    """
    Trigger indexing of a course's threads to Pinecone.
    Uses the user's token to fetch threads (respecting their permissions).
    """
    if index is None:
        raise HTTPException(
            status_code=503,
            detail=f"Pinecone index '{PINECONE_INDEX_NAME}' not available"
        )

    # Check if already syncing
    current_status = sync_status.get(request.course_id, {})
    if current_status.get("status") in ["fetching", "processing", "indexing"]:
        return {
            "message": "Sync already in progress",
            "status": current_status
        }

    # Start background sync
    background_tasks.add_task(sync_course_task, request.course_id, request.user_token)

    sync_status[request.course_id] = {
        "status": "starting",
        "message": "Starting sync..."
    }

    return {
        "message": "Sync started",
        "course_id": request.course_id
    }


@app.get("/sync_status/{course_id}")
def get_sync_status(course_id: int):
    """Get the sync status for a course."""
    status = sync_status.get(course_id, {"status": "unknown", "message": "No sync has been initiated"})
    return SyncStatus(course_id=course_id, **status)


@app.get("/search")
def search_endpoint(
    q: str = Query(..., description="User query"),
    k: int = Query(5, description="Number of results to return"),
    course_id: int = Query(..., description="Course ID to search within"),
    min_score: float = Query(0.5, description="Minimum similarity score threshold"),
):
    """
    Semantic search for threads using Pinecone.
    Returns top-k threads ranked by semantic similarity with reranking.
    """
    if index is None:
        raise HTTPException(
            status_code=503,
            detail=f"Pinecone index '{PINECONE_INDEX_NAME}' not available"
        )

    if not q.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    namespace = get_namespace(course_id)

    # Check cache first
    cache_key = f"{course_id}:{q}:{k}"
    if cache_key in query_cache:
        return query_cache[cache_key]

    try:
        # Search with reranking for better relevance
        results = index.search(
            namespace=namespace,
            query={
                "top_k": k * 2,  # Get more candidates for reranking
                "inputs": {
                    "text": q
                }
            },
            rerank={
                "model": "bge-reranker-v2-m3",
                "top_n": k,
                "rank_fields": ["content"]
            }
        )

        # Process results
        hits = results.get("result", {}).get("hits", [])

        formatted_results = []
        for hit in hits:
            score = hit.get("_score", 0)

            # Filter by minimum score
            if score < min_score:
                continue

            fields = hit.get("fields", {})
            formatted_results.append({
                "id": fields.get("thread_id"),
                "number": fields.get("thread_number"),
                "title": fields.get("title", ""),
                "content": fields.get("content", "")[:500],  # Truncate for response
                "category": fields.get("category", ""),
                "score": round(score, 4),
            })

        response = {
            "query": q,
            "course_id": course_id,
            "results": formatted_results,
            "total": len(formatted_results)
        }

        # Cache the result
        query_cache[cache_key] = response

        return response

    except Exception as e:
        # If namespace doesn't exist or other error, return empty results
        if "namespace" in str(e).lower() or "not found" in str(e).lower():
            return {
                "query": q,
                "course_id": course_id,
                "results": [],
                "total": 0,
                "message": "Course not indexed. Please sync the course first."
            }
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/index_stats")
def get_index_stats(course_id: Optional[int] = None):
    """Get statistics about the Pinecone index."""
    if index is None:
        raise HTTPException(
            status_code=503,
            detail=f"Pinecone index '{PINECONE_INDEX_NAME}' not available"
        )

    stats = index.describe_index_stats()

    response = {
        "total_vectors": stats.total_vector_count,
        "namespaces": {}
    }

    for ns_name, ns_stats in stats.namespaces.items():
        response["namespaces"][ns_name] = {
            "vector_count": ns_stats.vector_count
        }

    if course_id:
        namespace = get_namespace(course_id)
        ns_info = response["namespaces"].get(namespace, {"vector_count": 0})
        response["course_stats"] = {
            "course_id": course_id,
            "namespace": namespace,
            "indexed_threads": ns_info.get("vector_count", 0)
        }

    return response
