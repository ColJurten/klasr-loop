import os

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from crewai import Agent, Crew, LLM, Process, Task
from crewai.project import CrewBase, agent, crew, task

from .schemas import DecisionResult
from .tools import DoclingMarkdownTool, DoclingTextTool


def verbose_enabled() -> bool:
    return (
        os.getenv("KLASR_CONTAINER", "false").lower() != "true"
        and os.getenv("KLASR_DSA_VERBOSE", "false").lower() == "true"
    )


def llm_for(agent_name: str) -> LLM:
    suffix = agent_name.upper()

    def setting(name: str) -> str | None:
        return os.getenv(f"KLASR_LLM_{name}_{suffix}") or os.getenv(f"KLASR_LLM_{name}")

    provider, model = setting("PROVIDER"), setting("MODEL")
    if not provider or not model:
        raise ValueError("KLASR_LLM_PROVIDER and KLASR_LLM_MODEL are required")
    return LLM(
        model=f"{provider}/{model}",
        api_key=setting("API_KEY"),
        base_url=setting("BASE_URL"),
    )


@CrewBase
class DocumentSortingAssistantCrew:
    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def analyse_file_agent(self) -> Agent:
        return Agent(
            config=self.agents_config["analyse_file_agent"],
            tools=[DoclingMarkdownTool(), DoclingTextTool()],
            llm=llm_for("ANALYSE_FILE_AGENT"),
            verbose=verbose_enabled(),
        )

    @agent
    def suggest_filename_agent(self) -> Agent:
        return Agent(
            config=self.agents_config["suggest_filename_agent"],
            llm=llm_for("SUGGEST_FILENAME_AGENT"),
            verbose=verbose_enabled(),
        )

    @agent
    def suggest_directory_agent(self) -> Agent:
        return Agent(
            config=self.agents_config["suggest_directory_agent"],
            llm=llm_for("SUGGEST_DIRECTORY_AGENT"),
            verbose=verbose_enabled(),
        )

    @task
    def analyse_file_task(self) -> Task:
        return Task(config=self.tasks_config["analyse_file_task"], output_pydantic=DecisionResult)

    @task
    def suggest_filename_task(self) -> Task:
        return Task(
            config=self.tasks_config["suggest_filename_task"], output_pydantic=DecisionResult
        )

    @task
    def suggest_directory_task(self) -> Task:
        return Task(
            config=self.tasks_config["suggest_directory_task"], output_pydantic=DecisionResult
        )

    @crew
    def naming_crew(self) -> Crew:
        return Crew(
            agents=[self.analyse_file_agent(), self.suggest_filename_agent()],
            tasks=[self.analyse_file_task(), self.suggest_filename_task()],
            process=Process.sequential,
            verbose=verbose_enabled(),
        )

    @crew
    def destination_crew(self) -> Crew:
        return Crew(
            agents=[self.analyse_file_agent(), self.suggest_directory_agent()],
            tasks=[self.analyse_file_task(), self.suggest_directory_task()],
            process=Process.sequential,
            verbose=verbose_enabled(),
        )

    @crew
    def combined_crew(self) -> Crew:
        return Crew(
            agents=[
                self.analyse_file_agent(),
                self.suggest_filename_agent(),
                self.suggest_directory_agent(),
            ],
            tasks=[
                self.analyse_file_task(),
                self.suggest_filename_task(),
                self.suggest_directory_task(),
            ],
            process=Process.sequential,
            verbose=verbose_enabled(),
        )
