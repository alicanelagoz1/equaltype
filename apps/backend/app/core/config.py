from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "EqualType Phase-1"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    cache_max_items: int = 2000

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
