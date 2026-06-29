FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-server bash ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -s /bin/bash test \
  && echo "test:testpass" | chpasswd \
  && mkdir -p /run/sshd /home/test/projects/demo /home/test/logs \
  && printf "Hello from the TetherSSH test container\n" > /home/test/README.txt \
  && printf "alpha\nbeta\ngamma\n" > /home/test/projects/demo/sample.txt \
  && chown -R test:test /home/test \
  && sed -i "s/#PasswordAuthentication yes/PasswordAuthentication yes/" /etc/ssh/sshd_config \
  && sed -i "s/#PermitRootLogin prohibit-password/PermitRootLogin no/" /etc/ssh/sshd_config

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D", "-e"]
