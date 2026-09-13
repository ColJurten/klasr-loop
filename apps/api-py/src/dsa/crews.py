import os

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"

from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task

from .schemas import DecisionResult
from pydantic import PrivateAttr


class DisabledReplayStorage:
    """Privacy boundary: CrewAI replay would persist document content to SQLite."""

    def reset(self):
        return None

    def update(self, *_args):
        return None

    def load(self):
        return []


class EphemeralCrew(Crew):
    _task_output_handler = PrivateAttr(default_factory=DisabledReplayStorage)


def verbose_enabled() -> bool:
    os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
    os.environ["OTEL_SDK_DISABLED"] = "true"
    # Never emit prompts or extracted content, including CLI/container runs.
    return False


def llm_for(agent_name):
    if provider_factory.get() is not None:
        return provider_factory.get()(agent_name)
    from services.llm_provider import environment_llm

    return environment_llm(agent_name)


from contextvars import ContextVar

provider_factory = ContextVar("dsa_provider_factory", default=None)


@CrewBase
class DocumentSortingAssistantCrew:
    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def analyse_file_agent(self) -> Agent:
        return Agent(
            config=self.agents_config["analyse_file_agent"],
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
        return EphemeralCrew(
            agents=[self.analyse_file_agent(), self.suggest_filename_agent()],
            tasks=[self.analyse_file_task(), self.suggest_filename_task()],
            process=Process.sequential,
            verbose=verbose_enabled(),
            tracing=False,
        )

    @crew
    def destination_crew(self) -> Crew:
        return EphemeralCrew(
            agents=[self.analyse_file_agent(), self.suggest_directory_agent()],
            tasks=[self.analyse_file_task(), self.suggest_directory_task()],
            process=Process.sequential,
            verbose=verbose_enabled(),
            tracing=False,
        )

    @crew
    def combined_crew(self) -> Crew:
        return EphemeralCrew(
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
            tracing=False,
        )
